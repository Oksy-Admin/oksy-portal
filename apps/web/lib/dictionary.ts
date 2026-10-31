// "Words and names to confirm" (Stage 2b, decisions.md section 9): one page across all
// hospitals for status words, colours, insurer/TPA/department names and doctor names.
// Mirrors lib/mappings.ts (1b-ii): decisions of other hospitals of the same scheme are
// pre-filled suggestions; Owner/Admin can confirm status words and doctor names in bulk.

export type DictionaryKind = "STATUS_WORD" | "COLOUR" | "INSURER" | "TPA" | "DEPARTMENT" | "DOCTOR";
export type DictionaryStatus = "SUGGESTED" | "CONFIRMED" | "REJECTED" | "RETIRED";

/** One row of dictionary_entries, as the page reads it (RETIRED rows are history, not shown). */
export interface StoredEntry {
  id: string;
  kind: DictionaryKind;
  scheme: string;
  hospital_code: string | null;
  spelling_key: string;
  spelling_raw: string;
  standard_value: string;
  status: DictionaryStatus;
  evidence: { count?: number; tabs?: string[]; source?: string } | null;
  reason: string | null;
  decided_at: string | null;
}

/** One bulk confirm, as the page reads it (dictionary_entry_batches). */
export interface StoredBatch {
  id: string;
  kind: DictionaryKind;
  scheme: string;
  hospital_code: string;
  item_count: number;
  created_at: string;
  undone_at: string | null;
}

/** A confirmed decision another hospital of the same scheme made for the same spelling. */
export interface CrossSuggestion {
  standard_value: string;
  from: string[];
}

export type ItemState = "NEEDS_DECISION" | "DECIDED" | "REJECTED";

/** One row the page lists: a spelling within one kind + scheme + hospital (or scheme-wide). */
export interface DictionaryItem {
  entry: StoredEntry;
  state: ItemState;
  /** Undecided, hospital-scoped items only: how another hospital of the scheme decided it. */
  crossSuggestion: CrossSuggestion | null;
}

/** Kinds with a cross-hospital "Confirm all" (decisions.md section 5, Policy B + D). */
export const BULK_KINDS: DictionaryKind[] = ["STATUS_WORD", "DOCTOR"];
export const BULK_MAX = 50;

const ORDER: Record<ItemState, number> = { NEEDS_DECISION: 0, REJECTED: 1, DECIDED: 2 };

export function crossSuggestionFor(entry: StoredEntry, all: StoredEntry[]): CrossSuggestion | null {
  if (!entry.hospital_code) return null; // scheme-wide kinds: already one list for everyone
  const matches = all.filter(
    (e) => e.status === "CONFIRMED" && e.kind === entry.kind && e.scheme === entry.scheme && e.hospital_code !== entry.hospital_code && e.spelling_key === entry.spelling_key,
  );
  if (matches.length === 0) return null;
  const byValue = new Map<string, string[]>();
  for (const m of matches) byValue.set(m.standard_value, [...(byValue.get(m.standard_value) ?? []), m.hospital_code!]);
  const best = [...byValue].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))[0]!;
  return { standard_value: best[0], from: [...new Set(best[1])].sort() };
}

/** The decision list: one item per current (non-retired) row, open ones first. */
export function dictionaryItems(entries: StoredEntry[]): DictionaryItem[] {
  const current = entries.filter((e) => e.status !== "RETIRED");
  const out = current.map((entry) => ({
    entry,
    state: (entry.status === "SUGGESTED" ? "NEEDS_DECISION" : entry.status === "REJECTED" ? "REJECTED" : "DECIDED") as ItemState,
    crossSuggestion: entry.status === "SUGGESTED" ? crossSuggestionFor(entry, entries) : null,
  }));
  return out.sort(
    (a, b) =>
      a.entry.kind.localeCompare(b.entry.kind) ||
      (a.entry.hospital_code ?? "").localeCompare(b.entry.hospital_code ?? "") ||
      ORDER[a.state] - ORDER[b.state] ||
      a.entry.spelling_raw.localeCompare(b.entry.spelling_raw),
  );
}

/**
 * "Confirm all" for one kind + hospital + scheme (Stage 1b-ii pattern): its undecided
 * spellings that another hospital of the scheme already confirmed, each with that exact
 * value. The first BULK_MAX go in one action.
 */
export function bulkCandidates(items: DictionaryItem[], kind: DictionaryKind, hospitalCode: string, scheme: string): { take: DictionaryItem[]; rest: number } {
  const all = items.filter(
    (i) => i.state === "NEEDS_DECISION" && i.crossSuggestion && i.entry.kind === kind && i.entry.hospital_code === hospitalCode && i.entry.scheme === scheme,
  );
  return { take: all.slice(0, BULK_MAX), rest: Math.max(0, all.length - BULK_MAX) };
}

export const KIND_LABELS: Record<DictionaryKind, string> = {
  STATUS_WORD: "Status word",
  COLOUR: "Colour",
  INSURER: "Insurer name",
  TPA: "TPA name",
  DEPARTMENT: "Department name",
  DOCTOR: "Doctor name",
};
