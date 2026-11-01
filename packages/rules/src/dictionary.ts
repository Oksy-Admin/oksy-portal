// Stage 2b: dictionary suggestions (decisions.md section 9, lane 2 "AI suggestions, never
// applied by themselves"). Pure functions only: no database, no AI call. The worker calls
// these with the raw spellings it saw in one run and the spellings already in
// dictionary_entries (any status, so a spelling already decided is never asked again), and
// writes the results as SUGGESTED rows. clean.ts applies only CONFIRMED rows (lane 1).
import type { ColourMeaning, Stage } from "./clean.ts";
import { nameKey } from "./normalise.ts";

export type DictionaryKind = "STATUS_WORD" | "COLOUR" | "INSURER" | "TPA" | "DEPARTMENT" | "DOCTOR";

/** Kinds with a small, known vocabulary: every new spelling goes to the decision list once. */
const ALWAYS_ASK: DictionaryKind[] = ["STATUS_WORD", "INSURER", "TPA"];
/** Kinds with open-ended names (question 4, 31-Oct): only groups of similar spellings are asked. */
const ASK_ONLY_IF_SIMILAR: DictionaryKind[] = ["DEPARTMENT", "DOCTOR"];

/** Levenshtein edit distance (small strings only; used for spelling-similarity grouping). */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const row = [i];
    for (let j = 1; j <= n; j++) {
      row[j] = a[i - 1] === b[j - 1] ? prev[j - 1]! : 1 + Math.min(prev[j]!, row[j - 1]!, prev[j - 1]!);
    }
    prev = row;
  }
  return prev[n]!;
}

/** Two normalised spellings count as "similar" (question 4): a close typo, or one inside the other. */
export function isSimilarSpelling(a: string, b: string): boolean {
  if (a === b) return true;
  if (a.length >= 4 && b.length >= 4 && (a.includes(b) || b.includes(a))) return true;
  return levenshtein(a, b) <= 2;
}

/** Groups a list of normalised keys so that every key in a group is similar to at least one other. */
export function groupSimilarSpellings(keys: string[]): string[][] {
  const groups: string[][] = [];
  for (const k of keys) {
    const g = groups.find((grp) => grp.some((m) => isSimilarSpelling(m, k)));
    if (g) g.push(k);
    else groups.push([k]);
  }
  return groups;
}

/** A light keyword guess at the stage a hospital's own status word means (AI may suggest, never apply). */
export function guessStage(rawWord: string): Stage | "NOT_WRITTEN" | null {
  const k = nameKey(rawWord);
  if (!k || k === "0" || k === "na" || k === "nil") return "NOT_WRITTEN";
  if (/paid|settl|setteled/.test(k)) return "SETTLED";
  if (/approv/.test(k)) return "APPROVED";
  if (/reject|denied/.test(k)) return "REJECTED";
  if (/cancel/.test(k)) return "CANCELLED";
  if (/process|submit|pending/.test(k)) return "UNDER_PROCESSING";
  if (/treatment|admit|inpatient/.test(k)) return "UNDER_TREATMENT";
  return null;
}

/** The legend-tab label-to-meaning guess (moved out of sheet-data.ts, 2b: a suggestion, never an authority). */
const COLOUR_WORDS: Array<[RegExp, ColourMeaning]> = [
  [/pre\s*-?auth.*initiat/i, "PREAUTH_INITIATED"],
  [/pre\s*-?auth.*approv/i, "PREAUTH_APPROVED"],
  [/reject|denied|cancel/i, "REJECTED_OR_CANCELLED"],
  [/discharg/i, "DISCHARGED"],
  [/claim\s*submit|hard\s*copy/i, "CLAIM_SUBMITTED"],
  [/\bpaid\b|settled/i, "PAID"],
];

export function guessColourMeaning(label: string): ColourMeaning | null {
  return COLOUR_WORDS.find(([re]) => re.test(label))?.[1] ?? null;
}

export interface KnownSpelling {
  spellingKey: string;
}

export interface DictionarySuggestion {
  spellingKey: string;
  spellingRaw: string;
  standardValueGuess: string;
}

/**
 * Which of this run's raw spellings should become a new SUGGESTED dictionary_entries row.
 * `known` is every spelling_key already in the table for this kind + scheme (+ hospital for
 * the per-hospital kinds), any status (never ask about a spelling already decided).
 */
export function newDictionarySuggestions(kind: DictionaryKind, rawSpellings: string[], known: KnownSpelling[], guess: (raw: string) => string): DictionarySuggestion[] {
  const knownKeys = new Set(known.map((k) => k.spellingKey));
  const seen = new Map<string, string>(); // spellingKey -> first raw spelling seen this run
  for (const raw of rawSpellings) {
    const key = kind === "COLOUR" ? raw.toLowerCase() : nameKey(raw);
    if (!key || knownKeys.has(key) || seen.has(key)) continue;
    seen.set(key, raw);
  }
  if (seen.size === 0) return [];

  if (ALWAYS_ASK.includes(kind) || kind === "COLOUR") {
    return [...seen].map(([key, raw]) => ({ spellingKey: key, spellingRaw: raw, standardValueGuess: guess(raw) }));
  }

  // ASK_ONLY_IF_SIMILAR (department, doctor): a name with no similar spelling to anything
  // else known or seen this run is kept as written, no question. Only a group of 2+ similar
  // spellings (new-to-new, or new-to-known) is asked, so the group can be told apart once.
  const allKeys = [...knownKeys, ...seen.keys()];
  const groups = groupSimilarSpellings(allKeys);
  const ambiguous = new Set(groups.filter((g) => g.length > 1).flat());
  return [...seen].filter(([key]) => ambiguous.has(key)).map(([key, raw]) => ({ spellingKey: key, spellingRaw: raw, standardValueGuess: guess(raw) }));
}
