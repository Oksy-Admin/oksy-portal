// Column Mappings helpers shared by the page and its tests (no server imports).
// Stage 1b-i (decisions.md section 5, Policy B + D): one decision per hospital + scheme +
// normalised header, reused on every tab. The page lists each distinct header once.
import { autoIgnoreByHeader, headerKey } from "@oksy/rules/decisions";
import { IGNORE_FIELD } from "@oksy/rules/fields";

/** One stored column of a tab layout (column_mappings), as the page reads it. */
export interface StoredColumn {
  hospital_code: string;
  scheme: string | null;
  tab_name: string;
  source_header: string;
  header_key: string | null;
  canonical_field: string | null;
  status: string;
  review_reason: string | null;
}

/** One row of header_decisions, as the page reads it. */
export interface StoredDecision {
  hospital_code: string;
  scheme: string;
  header_key: string;
  canonical_field: string | null;
  accept_any_shape: boolean;
  method: string;
  decided_at: string;
}

export type HeaderState = "NEEDS_DECISION" | "CHECK_AGAIN" | "DECIDED" | "AUTO_IGNORED";

/** One distinct header of a hospital + scheme: what the page shows and decides once. */
export interface HeaderItem {
  hospital_code: string;
  scheme: string;
  header_key: string;
  header: string;
  tabs: string[];
  /** The most common proposal for the header (alias list or AI); never saved on its own. */
  suggestion: string | null;
  decision: StoredDecision | null;
  /** Why the worker stopped reuse (value-shape check, consistency guard), in plain words. */
  reasons: string[];
  state: HeaderState;
  autoIgnoreReason: string | null;
}

/** A blank header was stored as "Column N": nothing to decide on a name (kept in extra_fields). */
function keyOf(c: StoredColumn): string {
  if (c.header_key != null) return c.header_key;
  return /^Column \d+$/.test(c.source_header) ? "" : headerKey(c.source_header);
}

const ORDER: Record<HeaderState, number> = { CHECK_AGAIN: 0, NEEDS_DECISION: 1, DECIDED: 2, AUTO_IGNORED: 3 };

/** The decision list: one item per hospital + scheme + header, open ones first. */
export function headerItems(columns: StoredColumn[], decisions: StoredDecision[]): HeaderItem[] {
  const byKey = new Map<string, StoredColumn[]>();
  for (const c of columns) {
    const key = keyOf(c);
    if (!key || c.status === "RETIRED" || !c.scheme) continue;
    const k = `${c.hospital_code}\u0000${c.scheme}\u0000${key}`;
    byKey.set(k, [...(byKey.get(k) ?? []), c]);
  }
  const dec = new Map(decisions.map((d) => [`${d.hospital_code}\u0000${d.scheme}\u0000${d.header_key}`, d]));
  const out: HeaderItem[] = [];
  for (const [k, cols] of byKey) {
    const [hospital_code, scheme, header_key] = k.split("\u0000") as [string, string, string];
    const counts = new Map<string, number>();
    for (const c of cols) if (c.canonical_field) counts.set(c.canonical_field, (counts.get(c.canonical_field) ?? 0) + 1);
    const suggestion = [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? null;
    const decision = dec.get(k) ?? null;
    const reasons = [...new Set(cols.flatMap((c) => (c.review_reason ? [c.review_reason] : [])))];
    const header = cols[0]!.source_header;
    const autoIgnoreReason = autoIgnoreByHeader(header);
    const state: HeaderState = autoIgnoreReason ? "AUTO_IGNORED" : reasons.length > 0 ? "CHECK_AGAIN" : decision ? "DECIDED" : "NEEDS_DECISION";
    out.push({ hospital_code, scheme, header_key, header, tabs: [...new Set(cols.map((c) => c.tab_name))].sort(), suggestion, decision, reasons, state, autoIgnoreReason });
  }
  return out.sort(
    (a, b) => a.hospital_code.localeCompare(b.hospital_code) || a.scheme.localeCompare(b.scheme) || ORDER[a.state] - ORDER[b.state] || a.header.localeCompare(b.header),
  );
}

/** What the page shows for a stored choice. */
export function choiceLabel(field: string | null, labels: Record<string, string>): string {
  if (field === IGNORE_FIELD) return "Ignore (not needed)";
  if (field === null) return "Keep in extra columns";
  return labels[field] ?? field;
}

/**
 * A dropdown choice that is a decision on its own and is saved at once (Item 1, 27-Oct-2026):
 * Ignore. Other choices wait for Save.
 */
export function savesAtOnce(choice: string): boolean {
  return choice === IGNORE_FIELD;
}

/** Applies a dropdown choice: Ignore is saved through save (decide_header), anything else waits for Save. */
export async function applyChoice(
  choice: string,
  save: (field: string | null) => Promise<{ ok: boolean; error?: string }>,
): Promise<{ saved: boolean; ok: boolean; error?: string }> {
  if (!savesAtOnce(choice)) return { saved: false, ok: true };
  const res = await save(choice);
  return { saved: res.ok, ok: res.ok, error: res.error };
}
