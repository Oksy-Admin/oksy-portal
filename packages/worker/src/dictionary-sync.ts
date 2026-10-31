// Stage 2b (decisions.md section 9, lane 2): new spellings seen in one run are listed once,
// never applied. Reads every spelling_key already in dictionary_entries for the scope (any
// status, so a decided spelling is never asked again) and writes a SUGGESTED row for each
// genuinely new one (dictionary.ts decides which ones, question 4). Never blocks the run: an
// insert failure here is swallowed, the claim write still goes ahead.
import { guessColourMeaning, guessStage, newDictionarySuggestions, type DictionaryKind } from "@oksy/rules";
import type { Db } from "./db.ts";

export interface SeenSpellings {
  statusWords: string[];
  doctors: string[];
  insurers: string[];
  tpas: string[];
  departments: string[];
  /** Fill hex -> label text read from this run's LEGEND tab. */
  colours: Record<string, string>;
}

async function knownKeys(db: Db, kind: DictionaryKind, scheme: string, hospitalCode: string | null): Promise<string[]> {
  const scope = hospitalCode === null ? "hospital_code=is.null" : `hospital_code=eq.${encodeURIComponent(hospitalCode)}`;
  const rows = await db.select<{ spelling_key: string }>(`dictionary_entries?kind=eq.${kind}&scheme=eq.${encodeURIComponent(scheme)}&${scope}&select=spelling_key`);
  return rows.map((r) => r.spelling_key);
}

async function insertSuggestions(db: Db, rows: Array<Record<string, unknown>>) {
  if (rows.length === 0) return;
  try {
    await db.insert("dictionary_entries", rows);
  } catch {
    // Non-critical sidecar: the spelling is simply listed again on the next run.
  }
}

async function syncList(db: Db, kind: DictionaryKind, scheme: string, hospitalCode: string | null, raws: string[], tabs: string[], guess: (raw: string) => string) {
  if (raws.length === 0) return;
  const known = await knownKeys(db, kind, scheme, hospitalCode);
  const suggestions = newDictionarySuggestions(kind, raws, known.map((k) => ({ spellingKey: k })), guess);
  await insertSuggestions(
    db,
    suggestions.map((s) => ({
      kind,
      scheme,
      hospital_code: hospitalCode,
      spelling_key: s.spellingKey,
      spelling_raw: s.spellingRaw,
      standard_value: s.standardValueGuess || s.spellingRaw,
      status: "SUGGESTED",
      evidence: { count: raws.filter((r) => r === s.spellingRaw).length, tabs },
    })),
  );
}

/** Called once per hospital + scheme run, after cleaning (step 7); never for a tab that failed layout. */
export async function syncDictionarySuggestions(db: Db, hospitalCode: string, scheme: string, seen: SeenSpellings, tabs: string[]): Promise<void> {
  await syncList(db, "STATUS_WORD", scheme, hospitalCode, seen.statusWords, tabs, (raw) => guessStage(raw) ?? "");
  await syncList(db, "DOCTOR", scheme, hospitalCode, seen.doctors, tabs, (raw) => raw.trim());
  await syncList(db, "INSURER", scheme, null, seen.insurers, tabs, (raw) => raw.trim());
  await syncList(db, "TPA", scheme, null, seen.tpas, tabs, (raw) => raw.trim());
  await syncList(db, "DEPARTMENT", scheme, null, seen.departments, tabs, (raw) => raw.trim());

  const fills = Object.keys(seen.colours);
  if (fills.length === 0) return;
  const known = await knownKeys(db, "COLOUR", scheme, hospitalCode);
  const suggestions = newDictionarySuggestions("COLOUR", fills, known.map((k) => ({ spellingKey: k })), (fill) => guessColourMeaning(seen.colours[fill] ?? "") ?? "");
  await insertSuggestions(
    db,
    suggestions.map((s) => ({
      kind: "COLOUR",
      scheme,
      hospital_code: hospitalCode,
      spelling_key: s.spellingKey,
      spelling_raw: seen.colours[s.spellingRaw] ?? s.spellingRaw,
      standard_value: s.standardValueGuess || seen.colours[s.spellingRaw] || s.spellingRaw,
      status: "SUGGESTED",
      evidence: { tabs },
    })),
  );
}
