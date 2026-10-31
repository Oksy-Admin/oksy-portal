// Stage 2b (decisions.md section 9, lane 1): builds a HospitalProfile from CONFIRMED
// dictionary_entries and the hospital's own confirmed setup facts. Replaces hms-profile.ts:
// no status word, colour or name list is hard-coded here any more; only a CONFIRMED row is
// ever applied without asking (a SUGGESTED row is never used until a person decides it).
import type { ColourMeaning, DictionaryKind, HospitalProfile, Stage } from "@oksy/rules";

export type DictionaryStatus = "SUGGESTED" | "CONFIRMED" | "REJECTED" | "RETIRED";

export interface DictionaryRow {
  kind: DictionaryKind;
  scheme: string;
  hospital_code: string | null;
  spelling_key: string;
  standard_value: string;
  status: DictionaryStatus;
}

export interface HospitalFacts {
  tab_stage_facts: Record<string, Stage>;
  tpa_cell_may_hold_insurer: boolean;
  paid_meaning_open_tabs: string[];
  /** POD Number rules (R-K06) run only from this date (decisions.md section 8, moved here 1-Nov: the worker cannot read `hospitals`). */
  pod_start_date: string | null;
}

export function buildHospitalProfile(hospitalCode: string, scheme: string, facts: HospitalFacts, rows: DictionaryRow[]): HospitalProfile {
  const confirmed = rows.filter((r) => r.status === "CONFIRMED" && r.scheme === scheme);
  const byKind = (kind: DictionaryKind, hospitalScoped: boolean) =>
    confirmed.filter((r) => r.kind === kind && (hospitalScoped ? r.hospital_code === hospitalCode : r.hospital_code === null));
  const toMap = (list: DictionaryRow[]): Record<string, string> => Object.fromEntries(list.map((r) => [r.spelling_key, r.standard_value]));

  const insurerRows = byKind("INSURER", false);
  return {
    hospitalCode,
    scheme,
    tabStage: facts.tab_stage_facts,
    statusWords: toMap(byKind("STATUS_WORD", true)) as Record<string, Stage | "NOT_WRITTEN">,
    colourLegend: toMap(byKind("COLOUR", true)) as Record<string, ColourMeaning>,
    doctorAliases: toMap(byKind("DOCTOR", true)),
    insurerAliases: toMap(insurerRows),
    tpaAliases: toMap(byKind("TPA", false)),
    departmentAliases: toMap(byKind("DEPARTMENT", false)),
    tpaCellMayHoldInsurer: facts.tpa_cell_may_hold_insurer,
    insurerKeys: insurerRows.map((r) => r.spelling_key),
    paidMeaningOpenTabs: facts.paid_meaning_open_tabs,
    podStartDate: facts.pod_start_date,
  };
}
