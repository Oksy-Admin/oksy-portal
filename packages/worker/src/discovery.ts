// Tab discovery and the one-time column mapping (requirements v2 section 5, Stage 3).
// Every run lists the sheet's tabs (one metadata call). Month tabs (OCT 2026, SEP 2026) are
// candidates; helper tabs (TPA LIST) are DENY and never read; pre-made future month tabs
// wait. The first rows of the candidate month tabs are read once to find the header. A
// month tab whose header matches a layout a person confirmed for this sheet (hospital +
// scheme) becomes ALLOW DATA on its own; any other header waits for a person.
// A person's own decision on a tab (set_tab_policy) is never changed here.
// Logs counts and tab names only, never a cell value (hard rule 10).
import { policyForNewTab, toEventRows, type createReadPath, type GoogleEvent, type TabPolicy } from "@oksy/google";
import { classifyTabs, newestFirst, readChoice, type CanonicalField, type ColumnMap } from "@oksy/rules";
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
  /** Month tabs that became ALLOW because their header matches a confirmed mapping. */
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

/** Rows the worker may set: never decided by a person, or set by the worker before. */
export function isAutoManaged(t: Pick<TabRow, "policy" | "decided_at" | "decision_note">): boolean {
  if (t.decision_note?.startsWith("auto:")) return true;
  return t.policy === "REVIEW" && !t.decided_at;
}

/**
 * Confirmed layouts of one sheet: header fingerprint -> its APPROVED column rows. A layout
 * counts only when every column of it is APPROVED (a half-confirmed layout still waits).
 */
export function confirmedLayouts(rows: MappingRow[]): Map<string, MappingRow[]> {
  const groups = new Map<string, MappingRow[]>();
  for (const r of rows) {
    const k = `${r.header_fp}\u0000${r.tab_name}`;
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }
  const out = new Map<string, MappingRow[]>();
  for (const list of groups.values()) {
    if (list.some((r) => r.status !== "APPROVED")) continue;
    const fp = list[0]!.header_fp;
    if (!out.has(fp)) out.set(fp, list); // one set of columns per layout
  }
  return out;
}

/**
 * The confirmed mapping applied to a layout: columns not confirmed go to extra_fields;
 * columns a person set to Ignore are marked ignored and never read (decision 27-Oct-2026).
 */
export function applyConfirmed(layout: TabLayout, confirmed: MappingRow[]): TabLayout {
  const byCol = new Map(confirmed.map((c) => [c.source_column, c]));
  return {
    ...layout,
    map: layout.map.map((m) => {
      const c = byCol.get(m.column);
      const { field, ignored } = readChoice(c?.canonical_field ?? null);
      return { ...m, field, confidence: c ? 1 : 0, ...(ignored ? { ignored } : {}) };
    }),
  };
}

export function mappingRow(hospital: string, fileId: string, l: TabLayout, m: ColumnMap) {
  return {
    hospital_code: hospital,
    spreadsheet_id: fileId,
    tab_name: l.tab,
    header_fp: l.fingerprint,
    source_header: m.header || `Column ${m.column + 1}`,
    source_column: m.column,
    canonical_field: m.field,
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
  for (const r of approved.values()) if (r.canonical_field) held.add(r.canonical_field);
  return l.map.map((m) => {
    const a = approved.get(m.column);
    if (a) return { ...m, field: readChoice(a.canonical_field).field, confidence: 1, method: "MANUAL" };
    if (m.field && held.has(m.field)) return { ...m, field: null, confidence: 0, method: "UNMATCHED" };
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
    if (r.canonical_field === m.field && r.method === m.method && Number(r.confidence) === m.confidence) continue;
    out.push({ id: r.id, patch: { canonical_field: m.field, method: m.method, confidence: m.confidence } });
  }
  return out;
}

/** Stores a layout for confirmation (status PROPOSED), once per sheet and header. */
export async function proposeLayout(db: Db, hospital: string, fileId: string, l: TabLayout, map: ColumnMap[]): Promise<void> {
  await db.insert("column_mappings", map.map((m) => mappingRow(hospital, fileId, l, m)), {
    onConflict: "spreadsheet_id,tab_name,header_fp,source_column",
    ignoreDuplicates: true,
  });
}

export async function discoverTabs(sheet: { hospital_code: string; spreadsheet_id: string }, deps: DiscoveryDeps): Promise<DiscoverySummary> {
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
    `column_mappings?spreadsheet_id=eq.${enc(fileId)}&status=neq.RETIRED&select=id,tab_name,header_fp,source_column,canonical_field,status,method,confidence,approved_by,approved_at`,
  );
  const confirmed = confirmedLayouts(mappings);
  const proposedFps = new Set(mappings.map((m) => m.header_fp));
  const refreshedFps = new Set<string>();

  for (const m of open) {
    const raw = probe.find((t) => t.name === m.tab) ?? { name: m.tab, rows: [] };
    const l = layoutOf(raw, deps.extraHeaders);
    if (l.headerRow === null) {
      summary.waiting.push({ tab: m.tab, reason: "no header row in rows 1 to 10 (empty or pre-made tab)" });
      await setTab(m.tab, { policy: "REVIEW", kind: null, decided_by: null, decided_at: null, decision_note: "auto: no header row found" });
      continue;
    }
    const ok = confirmed.get(l.fingerprint);
    const approver = ok?.find((c) => c.approved_by)?.approved_by;
    if (ok && approver) {
      summary.autoAllowed.push(m.tab);
      const on = ok[0]?.approved_at?.slice(0, 10) ?? "";
      await setTab(m.tab, {
        policy: "ALLOW",
        kind: "DATA",
        decided_by: approver,
        decided_at: nowIso,
        decision_note: `auto: same header as the column mapping confirmed on ${on} (tab ${ok[0]?.tab_name})`,
      });
      continue;
    }
    const reason = confirmed.size > 0 ? "header differs from the confirmed column mapping" : "waiting for the column mapping to be confirmed";
    summary.waiting.push({ tab: m.tab, reason });
    await setTab(m.tab, { policy: "REVIEW", kind: null, decided_by: null, decided_at: null, decision_note: `auto: ${reason}` });
    if (!proposedFps.has(l.fingerprint)) {
      // Newest tab first, so each new layout is proposed from its newest month.
      const map = deps.suggest ? await deps.suggest(l, raw) : l.map;
      await proposeLayout(db, sheet.hospital_code, fileId, l, map);
      proposedFps.add(l.fingerprint);
      summary.proposedLayouts.push({
        tab: m.tab,
        columns: map.length,
        aliasMapped: map.filter((x) => x.method === "ALIAS" && x.field).length,
        aiMapped: map.filter((x) => x.method === "AI" && x.field).length,
      });
    } else if (deps.refresh && !refreshedFps.has(l.fingerprint)) {
      refreshedFps.add(l.fingerprint);
      const stored = mappings.filter((r) => r.header_fp === l.fingerprint);
      const base = { ...l, map: refreshBase(l, stored) };
      const map = deps.suggest ? await deps.suggest(base, raw) : base.map;
      const changes = proposalChanges(stored, map);
      for (const c of changes) await db.update(`column_mappings?id=eq.${c.id}&status=eq.PROPOSED`, c.patch);
      (summary.refreshedLayouts ??= []).push({
        tab: m.tab,
        columns: map.length,
        aliasMapped: map.filter((x) => x.method === "ALIAS" && x.field).length,
        aiMapped: map.filter((x) => x.method === "AI" && x.field).length,
        changed: changes.length,
      });
    }
  }
  return summary;
}
