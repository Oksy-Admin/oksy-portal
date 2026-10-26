// Cleaned data view and export (module H, D-051): one filter definition for the page and
// the export, so an export always holds exactly the rows the table shows. Filters and
// sorting run in the database (file 04 section 6); named columns only, never select *.
// Runs under the signed-in user's login: RLS limits it to ADMIN and APPROVER.

export const PAGE_SIZE = 50;

export const STAGES = ["UNDER_TREATMENT", "UNDER_PROCESSING", "APPROVED", "SETTLED", "REJECTED", "CANCELLED", "UNKNOWN"] as const;
export const CLASSES = ["CLEAN", "AUTO_FIXED", "NEEDS_STAFF_INPUT", "REJECTED"] as const;

export type ClaimFilters = { hospital?: string; stage?: string; cls?: string; tab?: string; q?: string; page?: string };

/** Columns shown in the table. */
export const TABLE_COLUMNS = [
  "record_uid", "hospital_code", "source_tab", "source_row", "preauth_or_claim_no", "patient_name", "admission_date",
  "insurer_name", "tpa_name", "bill_amount", "approved_amount", "copay_amount", "discount_1_amount", "tds_amount",
  "tds_rate_source", "settled_amount", "discount_2_amount", "claim_status", "status_source", "row_class", "issue_codes",
] as const;

/** Columns in the export: the canonical fields of file 01 section 4 (no internal IDs). */
export const EXPORT_COLUMNS = [
  "record_key", "hospital_code", "hospital_name", "scheme", "insurer_name", "tpa_name", "patient_name", "patient_ip_no",
  "policy_or_card_no", "preauth_or_claim_no", "admission_date", "discharge_date", "treatment_or_surgery", "department",
  "doctor_name", "room_no", "bill_amount", "claimed_amount", "approved_amount", "copay_amount", "deduction_amount",
  "casesheet_sent_date", "claim_status", "status_source", "rejection_reason", "cancellation_reason", "settled_amount",
  "settlement_date", "utr_no", "remarks", "los_days", "tds_rate_used", "tds_rate_source", "gross_amount", "tds_amount",
  "discount_1_amount", "discount_1_pct", "discount_2_amount", "discount_2_pct", "discount_2_confirmed", "tds_path",
  "discount_2_resolution", "overdue_flag", "pending_days", "aging_bucket", "row_class", "issue_codes", "flags",
  "not_recorded_fields", "source_file", "source_tab", "source_row", "sync_status", "last_changed_at",
] as const;

/** Amount columns totalled in the export log and checked against the database. */
export const TOTAL_COLUMNS = ["bill_amount", "approved_amount", "copay_amount", "settled_amount", "discount_1_amount", "discount_2_amount"] as const;

/** Only the filter values the page offers; anything else is ignored. */
export function cleanFilters(sp: ClaimFilters): Required<Omit<ClaimFilters, "page">> & { page: number } {
  const pick = (v: string | undefined, allowed: readonly string[]) => (v && allowed.includes(v) ? v : "");
  return {
    hospital: /^HOSP32P\d{6}$/.test(sp.hospital ?? "") ? sp.hospital! : "",
    stage: pick(sp.stage, STAGES),
    cls: pick(sp.cls, CLASSES),
    tab: (sp.tab ?? "").slice(0, 60),
    // Letters, digits, spaces and - / only: safe inside the database filter.
    q: (sp.q ?? "").replace(/[^A-Za-z0-9 /-]/g, "").trim().slice(0, 60),
    page: Math.max(1, Math.min(10000, Number.parseInt(sp.page ?? "1", 10) || 1)),
  };
}

// The Supabase query builder type is long; this is the part used here.
export interface Filterable<T> {
  eq(col: string, v: string): T;
  neq(col: string, v: string): T;
  or(expr: string): T;
}

export function applyFilters<T extends Filterable<T>>(query: T, f: ReturnType<typeof cleanFilters>): T {
  let q = query.neq("row_class", "NON_DATA_ROW");
  if (f.hospital) q = q.eq("hospital_code", f.hospital);
  if (f.stage) q = q.eq("claim_status", f.stage);
  if (f.cls) q = q.eq("row_class", f.cls);
  if (f.tab) q = q.eq("source_tab", f.tab);
  if (f.q) q = q.or(`preauth_or_claim_no.ilike.*${f.q}*,patient_name.ilike.*${f.q}*`);
  return q;
}

/** For the export log: filters without the page number. */
export function filtersForLog(f: ReturnType<typeof cleanFilters>): Record<string, string> {
  return Object.fromEntries(Object.entries(f).filter(([k, v]) => k !== "page" && v !== "").map(([k, v]) => [k, String(v)]));
}
