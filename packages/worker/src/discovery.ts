// Tab discovery and the one-time column mapping (requirements v2 section 5, Stage 3).
// Every run lists the sheet's tabs (one metadata call). Month tabs (OCT 2026, SEP 2026) are
// candidates; helper tabs (TPA LIST) are DENY and never read; pre-made future month tabs
// wait. The first rows of the candidate month tabs are read once to find the header. A
// month tab whose every header has a decision for this hospital + scheme (header_decisions,
// Policy B + D, Stage 1b) that passes the value-shape check becomes ALLOW DATA on its own;
// any other tab waits and its open headers go to the decision list.
// A person's own decision on a tab (set_tab_policy) is never changed here.
// Logs counts and tab names only, never a cell value (hard rule 10).
import { policyForNewTab, toEventRows, type createReadPath, type GoogleEvent, type TabPolicy } from "@oksy/google";
import {
  acceptsManyColumns,
  classifyTabs,
  headerKey,
  mappedKey,
  newestFirst,
  readChoice,
  resolveLayout,
  type CanonicalField,
  type ColumnMap,
  type ColumnNeed,
  type FieldDef,
  type HeaderDecision,
  type Resolved,
} from "@oksy/rules";
import { DbError } from "./db.ts";
import type { Db } from "./db.ts";
import { layoutOf, toRawTabs, type RawTab, type TabLayout } from "./sheet-data.ts";

const enc = encodeURIComponent;

/** Asks the AI for fields of columns the alias list could not map (see ai-mapping.ts). */
export type SuggestFn = (layout: TabLayout, probe: RawTab) => Promise<ColumnMap[]>;

export interface DiscoveryDeps {
  db: Db;
  read: ReturnType<typeof createReadPath>;
  events: Array<GoogleEvent & { at?: string }>;
  jobId: string;
  today: string; // ISO date, IST
  extraHeaders?: Record<string, CanonicalField>;
  suggest?: SuggestFn;
  /** The mapping_fields list (Fields page); the code list when absent or empty. */
  fields?: FieldDef[];
  /**
   * Re-propose layouts that are not confirmed yet, for example after the field list grew
   * (REFRESH_PROPOSALS=1 on the runner). Only PROPOSED rows change; a person's APPROVED
   * columns are kept as they are and their fields are not proposed again.
   */
  refresh?: boolean;
}

export interface DiscoverySummary {
  tabsFound: number;
  monthTabs: string[];
  helperTabs: string[];
  futureTabs: string[];
  /** Month tabs that became ALLOW because every header has a decision for this hospital + scheme. */
  autoAllowed: string[];
  /** Month tabs that wait for a person, with the reason. */
  waiting: Array<{ tab: string; reason: string }>;
  /** Header layouts proposed for confirmation in this run (one per new layout). */
  proposedLayouts: Array<{ tab: string; columns: number; aliasMapped: number; aiMapped: number }>;
  /** Layouts re-proposed in this run (refresh), with how many PROPOSED rows changed. */
  refreshedLayouts?: Array<{ tab: string; columns: number; aliasMapped: number; aiMapped: number; changed: number }>;
}

interface TabRow {
  tab_name: string;
  policy: TabPolicy;
  kind: string | null;
  decided_at: string | null;
  decision_note: string | null;
}

export interface MappingRow {
  id: string;
  review_reason?: string | null;
  tab_name: string;
  header_fp: string;
  source_column: number;
  canonical_field: string | null;
  status: string;
  method?: string;
  confidence?: number;
  approved_by: string | null;
  approved_at: string | null;
}

/**
 * The field list from mapping_fields, in order. Empty when the table is not there yet
 * (before migration 20261027000028): the code list is used then, so nothing changes.
 */
export async function loadFields(db: Db): Promise<FieldDef[]> {
  try {
    return await db.select<FieldDef>("mapping_fields?select=key,label,data_type,aliases,status,is_core,sort_order&order=sort_order");
  } catch (e) {
    if (e instanceof DbError && /status 404/.test(e.message)) return [];
    throw e;
  }
}

/** Rows the worker may set: never decided by a person, or set by the worker before. */
export function isAutoManaged(t: Pick<TabRow, "policy" | "decided_at" | "decision_note">): boolean {
  if (t.decision_note?.startsWith("auto:")) return true;
  return t.policy === "REVIEW" && !t.decided_at;
}

/** Every header decision of a hospital (all schemes: the consistency guard needs them). */
export async function loadDecisions(db: Db, hospital: string): Promise<HeaderDecision[]> {
  return db.select<HeaderDecision>(
    `header_decisions?hospital_code=eq.${enc(hospital)}&withdrawn_at=is.null&select=scheme,header_key,canonical_field,accept_any_shape,decided_by,decided_at`,
  );
}

/** The cell texts of one column below the header row (for the value-shape check). */
export function columnValues(raw: RawTab, headerRow: number | null, column: number): Array<string | null> {
  if (headerRow === null) return [];
  return raw.rows.slice(headerRow + 1).map((r) => r[column]?.[0] ?? null);
}

/**
 * The hospital + scheme decisions applied to a layout (resolveLayout). Undecided and
 * blocked columns go to extra_fields in the returned layout; the layout may be used only
 * when needs is empty.
 */
export function applyDecisions(
  layout: TabLayout,
  raw: RawTab | undefined,
  input: { scheme: string; decisions: HeaderDecision[]; fields?: FieldDef[] },
): Resolved & { layout: TabLayout } {
  const res = resolveLayout(layout, {
    ...input,
    ...(raw ? { values: (c: number) => columnValues(raw, layout.headerRow, c) } : {}),
  });
  return { ...res, layout: { ...layout, map: res.map } };
}

/** A person behind the decisions a layout uses (the tab's decided_by when it becomes ALLOW). */
export function decider(decisions: HeaderDecision[], scheme: string, layout: TabLayout): string | null {
  const keys = new Set(layout.map.map((m) => headerKey(m.header)));
  const used = decisions.filter((d) => d.scheme === scheme && keys.has(d.header_key) && d.decided_by);
  used.sort((a, b) => String(b.decided_at ?? "").localeCompare(String(a.decided_at ?? "")));
  return used[0]?.decided_by ?? null;
}

/** "3 headers need a decision: MAIL SUBJECT, MAIL SENT DATE, ..." (header names only, never a value). */
export function needsText(needs: ColumnNeed[]): string {
  const names = [...new Set(needs.map((n) => n.header.replace(/\s+/g, " ")))];
  return `${names.length} header${names.length === 1 ? "" : "s"} need${names.length === 1 ? "s" : ""} a decision: ${names.join(", ")}`;
}

/**
 * Stores why reuse stopped (value-shape check, consistency guard, one field twice) on the
 * layout's stored columns, and clears a reason that no longer holds. Only changed rows are written.
 */
export async function recordReviews(db: Db, stored: MappingRow[], layout: TabLayout, needs: ColumnNeed[]): Promise<void> {
  const want = new Map(needs.filter((n) => n.note).map((n) => [n.column, n.note]));
  for (const r of stored) {
    if (r.header_fp !== layout.fingerprint) continue;
    const reason = want.get(r.source_column) ?? null;
    if ((r.review_reason ?? null) === reason) continue;
    await db.update(`column_mappings?id=eq.${r.id}`, { review_reason: reason });
    r.review_reason = reason;
  }
}

/**
 * The proposal for a new layout: columns with a decision (or auto-Ignore) carry it, so the
 * AI is never asked about them; the rest keep the alias proposal.
 */
export function proposalBase(layout: TabLayout, resolved: Resolved): ColumnMap[] {
  const open = new Set(resolved.needs.map((n) => n.column));
  return layout.map.map((m) => {
    const r = resolved.map.find((x) => x.column === m.column);
    if (!r || open.has(m.column) || r.method !== "MANUAL") return m;
    return { ...r };
  });
}

export function mappingRow(hospital: string, fileId: string, l: TabLayout, m: ColumnMap, scheme: string) {
  return {
    hospital_code: hospital,
    scheme,
    header_key: headerKey(m.header),
    spreadsheet_id: fileId,
    tab_name: l.tab,
    header_fp: l.fingerprint,
    source_header: m.header || `Column ${m.column + 1}`,
    source_column: m.column,
    canonical_field: m.ignored ? "IGNORE" : mappedKey(m),
    confidence: m.confidence,
    method: m.method,
    status: "PROPOSED", // also the database default; never APPROVED by the worker or the AI
  };
}

/**
 * The base for re-proposing a layout that already has rows: a person's APPROVED columns
 * stay as they are (method MANUAL), and a field one of them holds is taken off any other
 * column, so the alias list or the AI cannot propose it twice.
 */
export function refreshBase(l: TabLayout, stored: MappingRow[]): ColumnMap[] {
  const approved = new Map(stored.filter((r) => r.status === "APPROVED").map((r) => [r.source_column, r]));
  const held = new Set<string>();
  // A field that takes several columns (remarks) is never "held": another column may map to it too.
  for (const r of approved.values()) if (r.canonical_field && !acceptsManyColumns(r.canonical_field)) held.add(r.canonical_field);
  return l.map.map((m) => {
    const a = approved.get(m.column);
    if (a) {
      const { field, custom } = readChoice(a.canonical_field);
      const { custom: _alias, ...rest } = m;
      return { ...rest, field, ...(custom ? { custom } : {}), confidence: 1, method: "MANUAL" };
    }
    const k = mappedKey(m);
    if (k && held.has(k)) return { column: m.column, header: m.header, field: null, confidence: 0, method: "UNMATCHED" };
    return m;
  });
}

/** PROPOSED rows whose proposal differs from the new map: the patch for each. */
export function proposalChanges(stored: MappingRow[], map: ColumnMap[]): Array<{ id: string; patch: { canonical_field: string | null; method: string; confidence: number } }> {
  const byCol = new Map(map.map((m) => [m.column, m]));
  const out: Array<{ id: string; patch: { canonical_field: string | null; method: string; confidence: number } }> = [];
  for (const r of stored) {
    const m = byCol.get(r.source_column);
    if (r.status !== "PROPOSED" || !m || m.method === "MANUAL") continue;
    if (r.canonical_field === mappedKey(m) && r.method === m.method && Number(r.confidence) === m.confidence) continue;
    out.push({ id: r.id, patch: { canonical_field: mappedKey(m), method: m.method, confidence: m.confidence } });
  }
  return out;
}

/** Stores a layout's columns (status PROPOSED), once per sheet and header: the decision list reads them. */
export async function proposeLayout(db: Db, hospital: string, scheme: string, fileId: string, l: TabLayout, map: ColumnMap[]): Promise<MappingRow[]> {
  return db.insert<MappingRow>("column_mappings", map.map((m) => mappingRow(hospital, fileId, l, m, scheme)), {
    onConflict: "spreadsheet_id,tab_name,header_fp,source_column",
    ignoreDuplicates: true,
    returning: true,
  });
}

export async function discoverTabs(sheet: { hospital_code: string; scheme: string; spreadsheet_id: string }, deps: DiscoveryDeps): Promise<DiscoverySummary> {
  const { db } = deps;
  const fileId = sheet.spreadsheet_id;
  const listed = await deps.read.listTabs(fileId, {});
  await db.insert("google_events", toEventRows(deps.events.splice(0), deps.jobId));

  // 1. Every tab gets a row (new ones start REVIEW); last_seen_at for the ones still there.
  const nowIso = new Date().toISOString();
  if (listed.length > 0) {
    await db.insert(
      "sheet_tabs",
      listed.map((t) => ({ spreadsheet_id: fileId, hospital_code: sheet.hospital_code, tab_name: t.title, policy: policyForNewTab(t.title) })),
      { onConflict: "spreadsheet_id,tab_name", ignoreDuplicates: true },
    );
  }
  const rows = await db.select<TabRow>(`sheet_tabs?spreadsheet_id=eq.${enc(fileId)}&select=tab_name,policy,kind,decided_at,decision_note`);
  const byName = new Map(rows.map((r) => [r.tab_name, r]));
  const present = new Set(listed.map((t) => t.title));
  for (const r of rows) {
    const patch = present.has(r.tab_name) ? { last_seen_at: nowIso, missing_since: null } : { missing_since: nowIso };
    await db.update(`sheet_tabs?spreadsheet_id=eq.${enc(fileId)}&tab_name=eq.${enc(r.tab_name)}`, patch);
  }

  const classes = classifyTabs(listed.map((t) => t.title), deps.today);
  const summary: DiscoverySummary = {
    tabsFound: listed.length,
    monthTabs: [],
    helperTabs: [],
    futureTabs: [],
    autoAllowed: [],
    waiting: [],
    proposedLayouts: [],
  };
  const setTab = async (tab: string, patch: Record<string, unknown>) => {
    const r = byName.get(tab);
    if (!r || !isAutoManaged(r)) return false;
    await db.update(`sheet_tabs?spreadsheet_id=eq.${enc(fileId)}&tab_name=eq.${enc(tab)}`, patch);
    return true;
  };

  // 2. Helper and future month tabs: never read.
  for (const c of classes) {
    if (c.type === "HELPER") {
      summary.helperTabs.push(c.tab);
      await setTab(c.tab, { policy: "DENY", kind: "EXCLUDED", decision_note: "auto: helper tab (not a month tab), never read" });
    } else if (c.type === "FUTURE_MONTH") {
      summary.futureTabs.push(c.tab);
      await setTab(c.tab, { policy: "REVIEW", kind: null, decided_by: null, decided_at: null, decision_note: "auto: future month tab, read from its month" });
    }
  }

  // 3. Month tabs the worker may decide: read their first rows and compare the header.
  const months = newestFirst(classes.flatMap((c) => (c.type === "MONTH" ? [c] : [])));
  summary.monthTabs = months.map((m) => m.tab);
  const open = months.filter((m) => {
    const r = byName.get(m.tab);
    return r && isAutoManaged(r);
  });
  if (open.length === 0) return summary;

  const probe = toRawTabs(await deps.read.readHeaderRows(fileId, open.map((m) => m.tab)));
  await db.insert("google_events", toEventRows(deps.events.splice(0), deps.jobId));
  const mappings = await db.select<MappingRow>(
    `column_mappings?spreadsheet_id=eq.${enc(fileId)}&status=neq.RETIRED&select=id,tab_name,header_fp,source_column,canonical_field,status,method,confidence,approved_by,approved_at,review_reason`,
  );
  const decisions = await loadDecisions(db, sheet.hospital_code);
  const proposedFps = new Set(mappings.map((m) => m.header_fp));
  const refreshedFps = new Set<string>();

  for (const m of open) {
    const raw = probe.find((t) => t.name === m.tab) ?? { name: m.tab, rows: [] };
    const l = layoutOf(raw, deps.extraHeaders, deps.fields);
    if (l.headerRow === null) {
      summary.waiting.push({ tab: m.tab, reason: "no header row in rows 1 to 10 (empty or pre-made tab)" });
      await setTab(m.tab, { policy: "REVIEW", kind: null, decided_by: null, decided_at: null, decision_note: "auto: no header row found" });
      continue;
    }
    const res = applyDecisions(l, raw, { scheme: sheet.scheme, decisions, fields: deps.fields });
    let isNew = false;
    if (!proposedFps.has(l.fingerprint)) {
      // Newest tab first, so each new layout is stored from its newest month.
      isNew = true;
      const base = { ...l, map: proposalBase(l, res) };
      const map = deps.suggest ? await deps.suggest(base, raw) : base.map;
      mappings.push(...(await proposeLayout(db, sheet.hospital_code, sheet.scheme, fileId, l, map)));
      proposedFps.add(l.fingerprint);
      summary.proposedLayouts.push({
        tab: m.tab,
        columns: map.length,
        aliasMapped: map.filter((x) => x.method === "ALIAS" && mappedKey(x)).length,
        aiMapped: map.filter((x) => x.method === "AI" && mappedKey(x)).length,
      });
    }
    await recordReviews(db, mappings, l, res.needs);

    const approver = res.needs.length === 0 ? decider(decisions, sheet.scheme, l) : null;
    if (approver) {
      summary.autoAllowed.push(m.tab);
      await setTab(m.tab, {
        policy: "ALLOW",
        kind: "DATA",
        decided_by: approver,
        decided_at: nowIso,
        decision_note: `auto: every header decided for this hospital + scheme (${res.reused} reused, ${res.autoIgnored.length} ignored automatically)`,
      });
      continue;
    }
    const reason = res.needs.length > 0 ? needsText(res.needs) : "no person has decided a header of this tab yet";
    summary.waiting.push({ tab: m.tab, reason });
    await setTab(m.tab, { policy: "REVIEW", kind: null, decided_by: null, decided_at: null, decision_note: `auto: ${reason}` });
    if (isNew) continue;
    if (deps.refresh && !refreshedFps.has(l.fingerprint)) {
      refreshedFps.add(l.fingerprint);
      const stored = mappings.filter((r) => r.header_fp === l.fingerprint);
      const refreshed = { ...l, map: refreshBase(l, stored) };
      const base = { ...l, map: proposalBase(refreshed, res) }; // decided and auto-Ignored columns are not re-proposed
      const map = deps.suggest ? await deps.suggest(base, raw) : base.map;
      const changes = proposalChanges(stored, map);
      for (const c of changes) await db.update(`column_mappings?id=eq.${c.id}&status=eq.PROPOSED`, c.patch);
      (summary.refreshedLayouts ??= []).push({
        tab: m.tab,
        columns: map.length,
        aliasMapped: map.filter((x) => x.method === "ALIAS" && mappedKey(x)).length,
        aiMapped: map.filter((x) => x.method === "AI" && mappedKey(x)).length,
        changed: changes.length,
      });
    }
  }
  return summary;
}
