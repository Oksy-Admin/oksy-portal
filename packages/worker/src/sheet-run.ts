// One sheet run (file 03 section 4; D-049, D-065): check SYNC, read ALLOW tabs once with a
// field mask, store a raw snapshot, map, clean, reconcile, then upsert claims and payments.
// An unexplained reconciliation difference stops the write. Logs carry counts and
// milliseconds only, never a cell value (hard rule 10).
import { createHash } from "node:crypto";
import { SheetNotReadableError, toEventRows, type createReadPath, type GoogleEvent, type TabPolicy } from "@oksy/google";
import {
  cleanRow,
  combineTwoPart,
  computeFingerprint,
  detectDateOrder,
  fieldsForConfirmation,
  fieldsReadBy,
  findTwoPartCandidates,
  isEmptyRow,
  markPending,
  openKeyOf,
  parseDate,
  type CheckDefinition,
  type CleanRow,
  type RuleAction,
  type RuleVersion,
} from "@oksy/rules";
import { chunks, type Db } from "./db.ts";
import {
  applyDecisions,
  discoverTabs,
  loadDecisions,
  loadFields,
  needsText,
  proposalBase,
  proposeLayout,
  recordReviews,
  type DiscoverySummary,
  type MappingRow,
  type SuggestFn,
} from "./discovery.ts";
import { syncDictionarySuggestions } from "./dictionary-sync.ts";
import { HMS_HEADERS, HMS_SHEET } from "./hospital-headers.ts";
import { checkSameClaims, checkSameUtr, dedupeExactRows, type CrossRowRules } from "./identity.ts";
import { buildHospitalProfile, type DictionaryRow, type HospitalFacts } from "./profile.ts";
import { emptyReconciliation, reconcile, type Reconciliation } from "./reconcile.ts";
import { layoutOf, legendLabelsFrom, sourceRows, toRawTabs, type TabLayout } from "./sheet-data.ts";

export interface Job {
  id: string;
  sheet_key: string;
  mode: "WRITE" | "DRY_RUN";
}

export interface RunDeps {
  db: Db;
  read: ReturnType<typeof createReadPath>;
  /** Google events collected by the read path's logger during this run. */
  events: Array<GoogleEvent & { at?: string }>;
  now?: () => Date;
  timing?: (step: string, ms: number) => void;
  /** AI column suggestions for a new header layout (Stage 3); alias list only when absent. */
  suggest?: SuggestFn;
  /** Re-propose layouts not confirmed yet with the current field list (see discovery.ts). */
  refreshProposals?: boolean;
}

export interface RunSummary {
  result: "WRITTEN" | "DRY_RUN" | "STOPPED_RECONCILIATION" | "STOPPED_LAYOUT";
  snapshotId: string;
  tabsRead: string[];
  tabsSkipped: Array<{ tab: string; policy: string }>;
  reconciliation: Reconciliation;
  sync?: { new: number; changed: number; unchanged: number; missing: number };
  payments?: number;
  issues?: { active: number; shadow: number; byRule: Record<string, number> };
  /** Tier B fixes per rule, and rows with at least one (AUTO_FIXED explained). */
  fixes?: Record<string, number>;
  layoutProblems?: string[];
  /** Tab discovery of this run (requirements v2 section 5). */
  discovery?: DiscoverySummary;
  /** Same claim inside this run (decision section 7): exact repeats not stored, conflicts and same-day patients flagged. */
  identity?: { duplicates: number; conflicting: number; samePatientSameDay: number; sameUtr: number };
  /** Two-part approval (decision section 7, 1-Nov): candidates found this run and how each was handled. */
  twoPart?: { confirmed: number; pending: number; newSuggestions: number };
  /** Rows below the header: read, skipped as non-data (serial-only, totals, banners), data. */
  rows?: { read: number; nonData: number; data: number };
  ms: Record<string, number>;
}

/** Things that stop a run on purpose (no retry). */
export class RunStopped extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RunStopped";
  }
}

interface SheetRow {
  sheet_key: string;
  hospital_code: string;
  scheme: string;
  spreadsheet_id: string | null;
  sync: string;
  read_skip_reason: string | null;
  missing_from_register_since: string | null;
}

function istDate(d: Date): string {
  return new Date(d.getTime() + 330 * 60000).toISOString().slice(0, 10);
}

function sha256(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

const enc = encodeURIComponent;

/** Hash of what the row means, not where it sits (a moved row is UNCHANGED, file 03 section 4.3). */
function contentHash(r: CleanRow): string {
  return sha256(
    JSON.stringify({
      claim: r.claim,
      payments: r.payments,
      flags: r.flags,
      nullReasons: r.nullReasons,
      rowClass: r.rowClass,
      issues: r.issues.map((i) => `${i.ruleId}:${i.field}:${i.shadow}`).sort(),
      extra: r.extra,
    }),
  );
}

export async function runSheetJob(job: Job, deps: RunDeps): Promise<RunSummary> {
  const { db } = deps;
  const now = deps.now ?? (() => new Date());
  const ms: Record<string, number> = {};
  const step = async <T>(name: string, fn: () => Promise<T> | T): Promise<T> => {
    const t = performance.now();
    try {
      return await fn();
    } finally {
      ms[name] = Math.round(performance.now() - t);
      deps.timing?.(name, ms[name]!);
    }
  };

  // 1. The sheet: never read a HOLD, NA, shared or retired sheet (hard rule 4) - no Google call.
  const [sheet] = await db.select<SheetRow>(
    `hospital_sheets?sheet_key=eq.${enc(job.sheet_key)}&select=sheet_key,hospital_code,scheme,spreadsheet_id,sync,read_skip_reason,missing_from_register_since`,
  );
  if (!sheet || !sheet.spreadsheet_id) throw new RunStopped("unknown sheet");
  if (sheet.sync !== "YES") throw new SheetNotReadableError(sheet.spreadsheet_id, `SYNC = ${sheet.sync}`);
  if (sheet.read_skip_reason) throw new SheetNotReadableError(sheet.spreadsheet_id, sheet.read_skip_reason);
  if (sheet.missing_from_register_since) throw new SheetNotReadableError(sheet.spreadsheet_id, "not in the latest register");
  const fileId = sheet.spreadsheet_id;

  // 2. Tab discovery (Stage 3): month tabs found, helper tabs DENY, a month tab with a
  //    decided header becomes ALLOW. Then only ALLOW tabs are put in the request.
  const today = istDate(now());
  const extraHeaders = fileId === HMS_SHEET ? HMS_HEADERS : {};
  const fields = await loadFields(db);
  const discovery = await step("discover", () =>
    discoverTabs(
      { hospital_code: sheet.hospital_code, scheme: sheet.scheme, spreadsheet_id: fileId },
      { db, read: deps.read, events: deps.events, jobId: job.id, today, extraHeaders, suggest: deps.suggest, refresh: deps.refreshProposals, fields },
    ),
  );
  const tabRows = await db.select<{ tab_name: string; policy: TabPolicy; kind: string | null }>(
    `sheet_tabs?spreadsheet_id=eq.${enc(fileId)}&missing_since=is.null&select=tab_name,policy,kind`,
  );

  const saved = Object.fromEntries(tabRows.map((t) => [t.tab_name, t.policy]));
  const kind = Object.fromEntries(tabRows.map((t) => [t.tab_name, t.kind]));

  const allowTabs = tabRows.filter((t) => t.policy === "ALLOW");
  if (allowTabs.length === 0) {
    return {
      result: "DRY_RUN",
      snapshotId: "none",
      tabsRead: [],
      tabsSkipped: tabRows.map((t) => ({ tab: t.tab_name, policy: t.policy })),
      reconciliation: emptyReconciliation(),
      discovery,
      ms,
    };
  }

  // 3. One read: values and background colour of the ALLOW tabs, field mask (D-049).
  const read = await step("read", () => deps.read.readAllowedTabs(fileId, saved));
  await db.insert("google_events", toEventRows(deps.events.splice(0), job.id));
  const rawTabs = toRawTabs(read);
  const tabsSkipped = tabRows.filter((t) => t.policy !== "ALLOW").map((t) => ({ tab: t.tab_name, policy: t.policy }));

  // 4. Layouts and the timestamped raw snapshot (never edited). A new copy only when the
  //    sheet changed since its last copy (decision 31-Oct); copies older than 12 months go.
  const dataTabs = rawTabs.filter((t) => kind[t.name] === "DATA");
  const found: TabLayout[] = dataTabs.map((t) => layoutOf(t, extraHeaders, fields));
  const raw = JSON.stringify(rawTabs);
  const rawSha = sha256(raw);
  const snap = await step("snapshot", async () => {
    const [last] = await db.select<{ id: string; raw_sha256: string }>(
      `snapshots?sheet_key=eq.${enc(sheet.sheet_key)}&select=id,raw_sha256&order=taken_at.desc&limit=1`,
    );
    const kept = last?.raw_sha256 === rawSha ? last : undefined;
    const [stored] = kept
      ? [kept]
      : await db.insert<{ id: string }>(
          "snapshots",
          [
            {
              job_id: job.id,
              hospital_code: sheet.hospital_code,
              sheet_key: sheet.sheet_key,
              spreadsheet_id: fileId,
              tabs: rawTabs.map((t) => {
                const l = found.find((x) => x.tab === t.name);
                return { name: t.name, kind: kind[t.name] ?? null, rows: t.rows.length, header_row: l?.headerRow ?? null, header_fp: l?.fingerprint ?? null };
              }),
              raw: JSON.parse(raw),
              raw_sha256: rawSha,
            },
          ],
          { returning: true },
        );
    await db.rpc<number>("purge_old_snapshots");
    return stored;
  });
  if (!snap) throw new Error("snapshot not stored");

  // 5. Mapping: one decision per hospital + scheme + header (header_decisions, Stage 1b),
  //    checked against the values of this run. A tab with an open header stops the sheet
  //    (R-Y01); its open headers go to the decision list.
  const layoutProblems: string[] = [];
  const known = await db.select<MappingRow>(
    `column_mappings?spreadsheet_id=eq.${enc(fileId)}&status=neq.RETIRED&select=id,tab_name,header_fp,source_column,canonical_field,status,approved_by,approved_at,review_reason`,
  );
  const decisions = await loadDecisions(db, sheet.hospital_code);
  const proposed = new Set(known.map((k) => k.header_fp));
  const layouts: TabLayout[] = [];
  for (const l of found) {
    if (l.headerRow === null) {
      layoutProblems.push(`${l.tab}: no header row found`);
      layouts.push(l);
      continue;
    }
    const raw = dataTabs.find((t) => t.name === l.tab)!;
    const res = applyDecisions(l, raw, { scheme: sheet.scheme, decisions, fields });
    if (!proposed.has(l.fingerprint)) {
      const base = { ...l, map: proposalBase(l, res) };
      known.push(...(await proposeLayout(db, sheet.hospital_code, sheet.scheme, fileId, l, deps.suggest ? await deps.suggest(base, raw) : base.map)));
      proposed.add(l.fingerprint);
      if (l.fingerprint) {
        await db.insert("version_groups", [{
          version_group: `VG-${sha256(l.fingerprint).slice(0, 8)}`,
          header_fp: l.fingerprint,
          headers: l.headers,
          hospital_code: sheet.hospital_code,
          tab_name: l.tab,
          status: "PROPOSED",
        }], { onConflict: "header_fp", ignoreDuplicates: true });
      }
    }
    await recordReviews(db, known, l, res.needs);
    if (res.needs.length === 0) {
      layouts.push(res.layout);
      continue;
    }
    layoutProblems.push(`${l.tab}: ${needsText(res.needs)} (R-Y01)`);
    layouts.push(l);
  }

  // 6. Hospital facts (hospitals table) and dictionaries (Stage 2b): only CONFIRMED rows are
  //    ever applied without asking (decisions.md section 9, lane 1). A SUGGESTED row waits for
  //    a person on the "Words and names to confirm" list.
  const legendTab = rawTabs.find((t) => kind[t.name] === "LEGEND");
  const legendLabels = legendLabelsFrom(legendTab);
  const [factsRow] = await db.select<HospitalFacts>(
    `hospital_profile_facts?hospital_code=eq.${enc(sheet.hospital_code)}&select=tab_stage_facts,tpa_cell_may_hold_insurer,paid_meaning_open_tabs,pod_start_date`,
  );
  const facts: HospitalFacts = factsRow ?? { tab_stage_facts: {}, tpa_cell_may_hold_insurer: false, paid_meaning_open_tabs: [], pod_start_date: null };
  // Two reads, not an "or" filter: hospital-scoped kinds (status words, colours, doctors) and
  // scheme-wide kinds (insurer, TPA, department names, hospital_code IS NULL).
  const [hospitalDict, schemeDict] = await Promise.all([
    db.select<DictionaryRow>(
      `dictionary_entries?status=eq.CONFIRMED&scheme=eq.${enc(sheet.scheme)}&hospital_code=eq.${enc(sheet.hospital_code)}&select=kind,scheme,hospital_code,spelling_key,standard_value,status`,
    ),
    db.select<DictionaryRow>(
      `dictionary_entries?status=eq.CONFIRMED&scheme=eq.${enc(sheet.scheme)}&hospital_code=is.null&select=kind,scheme,hospital_code,spelling_key,standard_value,status`,
    ),
  ]);
  const dictRows = [...hospitalDict, ...schemeDict];
  const profile = buildHospitalProfile(sheet.hospital_code, sheet.scheme, facts, dictRows);

  // 7. Clean every non-empty row; one date order for the sheet (file 02 section 3).
  const [rawRules, rawVersions] = await Promise.all([
    db.select<{ rule_id: string; rule_type: "CHECK" | "PARAMETER" }>("rules?select=rule_id,rule_type"),
    db.select<{
      rule_id: string;
      version: number;
      status: string;
      hospital_filter: string | null;
      scheme_filter: string | null;
      insurer_filter: string | null;
      valid_from: string | null;
      valid_to: string | null;
      parameter_name: string | null;
      parameter_value: number | string | null;
      severity: "E" | "W" | null;
      check_definition: CheckDefinition | null;
      action: RuleAction | null;
      staff_message: string | null;
    }>(
      "rule_versions?select=rule_id,version,status,hospital_filter,scheme_filter,insurer_filter,valid_from,valid_to,parameter_name,parameter_value,severity,check_definition,action,staff_message",
    ),
  ]);

  const ruleTypes = new Map(rawRules.map((r) => [r.rule_id, r.rule_type]));
  const ruleVersions: RuleVersion[] = rawVersions.map((v) => ({
    ruleId: v.rule_id,
    version: v.version,
    type: ruleTypes.get(v.rule_id) ?? (v.parameter_name ? "PARAMETER" : "CHECK"),
    status: v.status as any,
    hospitalFilter: v.hospital_filter,
    schemeFilter: v.scheme_filter,
    insurerFilter: v.insurer_filter,
    validFrom: v.valid_from,
    validTo: v.valid_to,
    parameterName: v.parameter_name,
    parameterValue: v.parameter_value != null ? String(v.parameter_value) : null,
    severity: v.severity,
    checkDefinition: v.check_definition,
    action: v.action,
    staffMessage: v.staff_message,
  }));

  const srcRows = await step("map", () =>
    dataTabs.flatMap((t) => {
      const l = layouts.find((x) => x.tab === t.name)!;
      return sourceRows(t, l).filter((r) => !isEmptyRow(r));
    }),
  );
  const dateOrder = detectDateOrder(
    srcRows.flatMap((r) =>
      (["admission_date", "discharge_date", "payment_date", "casesheet_sent_date"] as const).map((f) => parseDate(r.cells[f], today).parts),
    ),
  );
  const cleaned = await step("clean", () => srcRows.map((r) => cleanRow(profile, r, { today, dateOrder, ruleVersions })));

  // 6b. Two-part approval (decisions.md section 7, 1-Nov): combine only after a person
  // confirms (claim_links). Candidates are found on rows not already an exact duplicate, and
  // before the normal "same claim, different values" conflict check, which would otherwise
  // flag every pending or confirmed pair as a data conflict.
  // An ACTIVE CHECK rule with no check_definition is, by construction, a structural rule whose
  // comparison stays in code (the allowed exception, same as R-C01/R-N02) - no rule ID is
  // named here, so a rule like this can be added, edited or made Inactive from the Rule
  // Library alone, same as every other rule (2a done-criteria).
  const crossRowRules: CrossRowRules = {};
  for (const v of ruleVersions) {
    if (v.type === "CHECK" && v.status === "ACTIVE" && !v.checkDefinition && v.severity) {
      crossRowRules[v.ruleId] = { severity: v.severity, staffMessage: v.staffMessage ?? null };
    }
  }
  const twoPart = await step("two-part", async () => {
    const { kept } = dedupeExactRows(cleaned);
    const candidates = findTwoPartCandidates(kept);
    if (candidates.length === 0) return { confirmed: 0, pending: 0, newSuggestions: 0, combined: [] as Array<{ primaryKey: string; secondaryKey: string }> };
    const links = await db.select<{ primary_record_key: string; secondary_record_key: string; status: string }>(
      `claim_links?hospital_code=eq.${enc(sheet.hospital_code)}&scheme=eq.${enc(sheet.scheme)}&select=primary_record_key,secondary_record_key,status`,
    );
    const linkStatus = new Map(links.map((l) => [`${l.primary_record_key}|${l.secondary_record_key}`, l.status]));
    const newSuggestions: Array<Record<string, unknown>> = [];
    const combined: Array<{ primaryKey: string; secondaryKey: string }> = [];
    let confirmed = 0;
    let pending = 0;
    for (const c of candidates) {
      const secondaryKey = `${c.key}#2`;
      const status = linkStatus.get(`${c.key}|${secondaryKey}`);
      if (status === "CONFIRMED") {
        const primarySource = srcRows.find((s) => s.tab === c.primary.tab && s.row === c.primary.row);
        if (primarySource) {
          const result = combineTwoPart(c, primarySource, profile, { today, dateOrder, ruleVersions });
          const idx = cleaned.indexOf(c.primary);
          if (idx >= 0) cleaned[idx] = result.primary;
          combined.push({ primaryKey: c.key, secondaryKey });
          confirmed++;
        }
      } else if (status === "REJECTED") {
        // Falls through to checkSameClaims below: a real data conflict, flagged as usual.
      } else {
        markPending(c);
        pending++;
        if (status === undefined) {
          newSuggestions.push({
            hospital_code: sheet.hospital_code,
            scheme: sheet.scheme,
            status: "SUGGESTED",
            primary_record_key: c.key,
            secondary_record_key: secondaryKey,
            evidence: { approved_amount: c.primary.claim!.approved_amount, utrs: [c.primary.claim!.utr_no, c.secondary.claim!.utr_no] },
          });
        }
      }
    }
    if (newSuggestions.length) await db.insert("claim_links", newSuggestions, { onConflict: "primary_record_key,secondary_record_key", ignoreDuplicates: true });
    return { confirmed, pending, newSuggestions: newSuggestions.length, combined };
  });

  const same = checkSameClaims(cleaned, sheet.scheme, crossRowRules);
  const sameUtr = checkSameUtr(cleaned, crossRowRules);

  // 7b. New spellings this run go to the decision list once (Stage 2b); never blocks the run.
  await step("dictionary-sync", async () => {
    try {
      const textOf = (f: "status_text" | "doctor_name" | "insurer_name" | "tpa_name" | "department") =>
        srcRows.map((r) => r.cells[f]?.text?.trim()).filter((t): t is string => !!t);
      await syncDictionarySuggestions(
        db,
        sheet.hospital_code,
        sheet.scheme,
        {
          statusWords: textOf("status_text"),
          doctors: textOf("doctor_name"),
          insurers: textOf("insurer_name"),
          tpas: textOf("tpa_name"),
          departments: textOf("department"),
          colours: legendLabels,
        },
        dataTabs.map((t) => t.name),
      );
    } catch {
      // Non-critical sidecar (decisions.md section 9): the spelling is listed again next run.
    }
  });

  // 8. Reconcile before any write.
  const rec = reconcile(dataTabs, layouts, cleaned);
  const base: RunSummary = {
    result: "DRY_RUN",
    snapshotId: snap.id,
    tabsRead: rawTabs.map((t) => t.name),
    tabsSkipped,
    reconciliation: rec,
    layoutProblems,
    discovery,
    rows: { read: srcRows.length, nonData: cleaned.filter((r) => r.rowClass === "NON_DATA_ROW").length, data: cleaned.filter((r) => r.rowClass !== "NON_DATA_ROW").length },
    issues: issueCounts(cleaned),
    identity: { duplicates: same.duplicates.size, conflicting: same.conflicting, samePatientSameDay: same.samePatientSameDay, sameUtr: sameUtr.flagged },
    twoPart: { confirmed: twoPart.confirmed, pending: twoPart.pending, newSuggestions: twoPart.newSuggestions },
    fixes: fixCounts(cleaned),
    ms,
  };
  const stopped = layoutProblems.length > 0 ? "STOPPED_LAYOUT" : rec.result === "FAIL" ? "STOPPED_RECONCILIATION" : null;
  await db.insert("reconciliations", [
    {
      job_id: job.id,
      snapshot_id: snap.id,
      hospital_code: sheet.hospital_code,
      sheet_key: sheet.sheet_key,
      counts: { ...rec.counts, date_order: dateOrder, layout_problems: layoutProblems },
      sums: rec.sums,
      differences: rec.differences,
      result: stopped ? "FAIL" : "PASS",
    },
  ]);
  if (stopped) return { ...base, result: stopped };
  if (job.mode === "DRY_RUN") return base;

  // 9. Write by upsert, never plain insert (file 03 section 4.9).
  const written = await step("write", () =>
    writeRows(db, job, sheet, fileId, cleaned.filter((r) => !same.duplicates.has(r)), now(), ruleVersions, twoPart.combined),
  );
  return { ...base, result: "WRITTEN", ...written };
}

function fixCounts(rows: CleanRow[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of rows) for (const rule of new Set(r.changes.map((c) => c.ruleId))) out[rule] = (out[rule] ?? 0) + 1;
  return out;
}

function issueCounts(rows: CleanRow[]) {
  const byRule: Record<string, number> = {};
  let active = 0;
  let shadow = 0;
  for (const r of rows)
    for (const i of r.issues) {
      if (i.ruleId === "R-C01") continue;
      byRule[i.ruleId + (i.shadow ? " (shadow)" : "")] = (byRule[i.ruleId + (i.shadow ? " (shadow)" : "")] ?? 0) + 1;
      if (i.shadow) shadow++;
      else active++;
    }
  return { active, shadow, byRule };
}

type ExistingClaim = Record<string, unknown> & { record_uid: string; record_key: string; content_hash: string };

const CLAIM_COLUMNS = [
  "insurer_name", "tpa_name", "patient_name", "patient_ip_no", "policy_or_card_no", "phone_number", "policy_holder_name",
  "preauth_or_claim_no", "admission_date", "discharge_date", "treatment_or_surgery", "department", "doctor_name", "room_no",
  "bill_amount", "claimed_amount", "approved_amount", "copay_amount", "deduction_amount", "discount_amount",
  "casesheet_sent_date", "courier_no", "followup_log", "claim_status", "status_source", "rejection_reason",
  "cancellation_reason", "settled_amount", "settlement_date", "utr_no", "remarks", "los_days", "date_swap_applied",
  "tds_rate_used", "tds_rate_source", "tds_rule_id", "tds_amount", "expected_tds_amount", "expected_settlement_amount",
  "balance_amount", "overdue_flag", "pending_days", "aging_bucket",
] as const;

function norm(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (Array.isArray(v)) return JSON.stringify(v);
  const s = String(v);
  return /^-?\d+(\.\d+)?$/.test(s) ? String(Number(s) === 0 ? "0" : s.replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "")) : s;
}

async function writeRows(
  db: Db,
  job: Job,
  sheet: SheetRow,
  fileId: string,
  rows: CleanRow[],
  at: Date,
  ruleVersions: RuleVersion[],
  twoPartCombined: Array<{ primaryKey: string; secondaryKey: string }>,
) {
  const nowIso = at.toISOString();
  const checkDefById = new Map(ruleVersions.map((v) => [v.ruleId, v.checkDefinition ?? null]));
  const data = rows.filter((r) => r.claim && r.recordKey);
  const existing = await db.select<ExistingClaim>(
    `claims_staging?hospital_code=eq.${enc(sheet.hospital_code)}&scheme=eq.${enc(sheet.scheme)}&select=record_uid,record_key,content_hash,${CLAIM_COLUMNS.join(",")}`,
  );
  const byKey = new Map(existing.map((e) => [e.record_key, e]));

  // A claim stored while the patient was still in hospital (no discharge date) keeps its record
  // when the date is filled in: its key moves to the new one, the old key stays in record_keys,
  // and the filled-in date is logged as a change (decision section 7; never a new claim).
  for (const r of rows) {
    if (!r.recordKey || !r.claim || byKey.has(r.recordKey)) continue;
    const openKey = openKeyOf(r.recordKey);
    const old = openKey ? byKey.get(openKey) : undefined;
    if (!old || old.discharge_date != null) continue;
    await db.update(`claims_staging?record_uid=eq.${enc(old.record_uid)}`, { record_key: r.recordKey });
    old.record_key = r.recordKey;
    byKey.delete(openKey!);
    byKey.set(r.recordKey, old);
  }
  const counts = { new: 0, changed: 0, unchanged: 0, missing: 0 };
  const changedRows: Array<Record<string, unknown>> = [];
  const unchangedRows: Array<Record<string, unknown>> = [];
  const hashes = new Map<string, string>();

  for (const r of data) {
    const hash = contentHash(r);
    hashes.set(r.recordKey!, hash);
    const old = byKey.get(r.recordKey!);
    const status = !old ? "NEW" : old.content_hash === hash ? "UNCHANGED" : "CHANGED";
    counts[status.toLowerCase() as "new" | "changed" | "unchanged"]++;
    const payload: Record<string, unknown> = {
      record_key: r.recordKey,
      hospital_code: sheet.hospital_code,
      scheme: sheet.scheme,
      ...r.claim,
      extra_fields: r.extra,
      null_reasons: r.nullReasons,
      flags: r.flags,
      source_file: fileId,
      source_tab: r.tab,
      source_row: r.row,
      version_group: "VG-1",
      row_class: r.rowClass,
      issue_codes: [...new Set(r.issues.filter((i) => !i.shadow && i.ruleId !== "R-C01").map((i) => i.ruleId))],
      not_recorded_fields: Object.entries(r.nullReasons).filter(([, v]) => v === "NOT_RECORDED_IN_SOURCE").map(([k]) => k),
      content_hash: hash,
      last_seen_at: nowIso,
      missing_since: null,
      sync_status: status,
      last_job_id: job.id,
    };
    if (status === "UNCHANGED") unchangedRows.push(payload);
    else changedRows.push({ ...payload, last_changed_at: nowIso });
  }

  // Claims (batches of 500, ON CONFLICT record_key).
  const uidByKey = new Map<string, string>();
  for (const batch of [...chunks(changedRows, 500), ...chunks(unchangedRows, 500)]) {
    const out = await db.insert<{ record_uid: string; record_key: string }>("claims_staging", batch, { onConflict: "record_key", returning: true });
    for (const o of out) uidByKey.set(o.record_key, o.record_uid);
  }

  // Two-part approval (decisions.md section 7, 1-Nov): the secondary part points at the
  // combined (primary) claim; never deleted, just excluded from the claims list/reports.
  for (const { primaryKey, secondaryKey } of twoPartCombined) {
    const primaryUid = uidByKey.get(primaryKey);
    const secondaryUid = uidByKey.get(secondaryKey);
    if (primaryUid && secondaryUid) await db.update(`claims_staging?record_uid=eq.${enc(secondaryUid)}`, { combined_into_record_uid: primaryUid });
  }

  // Record keys: the key used plus the fallback key when both exist (file 03 section 5).
  const keyRows = data.flatMap((r) => {
    const uid = uidByKey.get(r.recordKey!)!;
    const list = [{ record_key: r.recordKey, record_uid: uid, key_type: r.keyType ?? "FALLBACK", hospital_code: sheet.hospital_code, scheme: sheet.scheme }];
    return list;
  });
  for (const b of chunks(keyRows, 500)) await db.insert("record_keys", b, { onConflict: "record_key", ignoreDuplicates: true });

  // Field-level change log for CHANGED rows, and the engine's tier B changes for NEW and CHANGED rows.
  const changeRows: Array<Record<string, unknown>> = [];
  for (const r of data) {
    const uid = uidByKey.get(r.recordKey!)!;
    const old = byKey.get(r.recordKey!);
    const isNewOrChanged = !old || old.content_hash !== hashes.get(r.recordKey!);
    if (!isNewOrChanged) continue;
    if (old) {
      for (const col of CLAIM_COLUMNS) {
        const a = norm(old[col]);
        const b = norm((r.claim as unknown as Record<string, unknown>)[col]);
        if (a !== b) changeRows.push({ record_uid: uid, field: col, old_value: a, new_value: b, actor: "SHEET", job_id: job.id });
      }
    }
    for (const c of r.changes) {
      changeRows.push({ record_uid: uid, field: c.field, old_value: c.oldValue, new_value: c.newValue, rule_id: c.ruleId, tier: c.tier, actor: "AUTO", job_id: job.id });
    }
  }
  for (const b of chunks(changeRows, 500)) await db.insert("change_log", b);

  // Payments (ON CONFLICT record_uid, payment_no).
  const payRows = data.flatMap((r) =>
    r.payments.map((p) => ({
      record_uid: uidByKey.get(r.recordKey!),
      record_key: r.recordKey,
      payment_no: p.paymentNo,
      hospital_code: sheet.hospital_code,
      payment_date: p.paymentDate,
      utr_no: p.utrNo,
      amount_received: p.amountReceived,
      tds_amount_stated: p.tdsAmountStated,
      flags: p.flags,
      source_file: fileId,
      source_tab: r.tab,
      source_row: r.row,
      content_hash: sha256(JSON.stringify(p)),
      last_seen_at: nowIso,
      missing_since: null,
    })),
  );
  for (const b of chunks(payRows, 500)) await db.insert("payments", b, { onConflict: "record_uid,payment_no" });

  // "Value is correct" (decisions.md section 9, 1-Nov): a Warning stays confirmed while its
  // fingerprinted fields are unchanged; a confirmation of a value that has since changed is
  // simply not matched (the Warning re-opens, never silently kept against a different value).
  const confirmableUids = [...new Set(data.map((r) => uidByKey.get(r.recordKey!)).filter((u): u is string => !!u))];
  const latestConfirmation = new Map<string, string>();
  for (const b of chunks(confirmableUids, 100)) {
    const rows = await db.select<{ record_uid: string; rule_id: string; field: string; fingerprint: string }>(
      `issue_confirmations?record_uid=in.(${b.join(",")})&select=record_uid,rule_id,field,fingerprint&order=confirmed_at.desc`,
    );
    for (const c of rows) {
      const k = `${c.record_uid}|${c.rule_id}|${c.field}`;
      if (!latestConfirmation.has(k)) latestConfirmation.set(k, c.fingerprint); // first seen per key = latest (desc order)
    }
  }

  // Issues (ON CONFLICT record_uid, rule_id, field); issues no longer raised are resolved.
  const issueRows = data.flatMap((r) => {
    const uid = uidByKey.get(r.recordKey!)!;
    return dedupeIssues(r).map((i) => {
      let status: "OPEN" | "CONFIRMED" = "OPEN";
      if (i.severity === "W" && !i.shadow && r.claim) {
        const fields = fieldsForConfirmation(i.ruleId, checkDefById.get(i.ruleId) ?? null, fieldsReadBy);
        if (fields.length > 0 && latestConfirmation.get(`${uid}|${i.ruleId}|${i.field}`) === computeFingerprint(fields, r.claim)) status = "CONFIRMED";
      }
      return {
        record_uid: uid,
        hospital_code: sheet.hospital_code,
        rule_id: i.ruleId,
        severity: i.severity,
        tier: i.tier,
        shadow: i.shadow,
        field: i.field,
        detail: i.detail,
        status,
        last_job_id: job.id,
        last_seen_at: nowIso,
        resolved_at: null,
      };
    });
  });
  for (const b of chunks(issueRows, 500)) await db.insert("issues", b, { onConflict: "record_uid,rule_id,field" });
  for (const b of chunks([...uidByKey.values()], 100)) {
    await db.update(`issues?record_uid=in.(${b.join(",")})&status=in.(OPEN,CONFIRMED)&last_job_id=neq.${job.id}`, { status: "RESOLVED", resolved_at: nowIso });
  }

  // Records no longer in the sheet: MISSING, never deleted (file 03 section 4.3).
  const missing = existing.filter((e) => !hashes.has(e.record_key));
  for (const b of chunks(missing.map((m) => m.record_uid), 100)) {
    await db.update(`claims_staging?record_uid=in.(${b.join(",")})&missing_since=is.null`, { missing_since: nowIso, sync_status: "MISSING", last_job_id: job.id });
  }
  counts.missing = missing.length;

  return { sync: counts, payments: payRows.length };
}

/** One issue per rule and field per row (the table key). */
function dedupeIssues(r: CleanRow) {
  const seen = new Set<string>();
  return r.issues.filter((i) => {
    if (i.ruleId === "R-C01") return false;
    const k = `${i.ruleId}|${i.field}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
