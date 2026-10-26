import Link from "next/link";
import { can } from "@/lib/roles";
import { createClient, getMe } from "@/lib/supabase/server";
import { icons } from "../icons";
import { NoAccess, PageHead } from "../ui";
import { HospitalTable, type SheetRowData } from "./hospital-table";
import { withTiming } from "@/lib/timing";

async function HospitalsPage() {
  const me = await getMe();
  if (!can(me?.role, "helper_work")) return <NoAccess title="Hospitals" who="HELPER, APPROVER or ADMIN" />;

  const supabase = await createClient();
  const [hosp, sheets] = await Promise.all([
    supabase.from("hospitals").select("hospital_code, hospital_name, district, status, needs_review, missing_from_register_since"),
    supabase
      .from("hospital_sheets")
      .select("sheet_key, hospital_code, scheme, sheet_status, spreadsheet_id, sheet_url, sync, read_skip_reason, check_flag, access_status, access_error, last_checked_at, needs_review")
      .is("missing_from_register_since", null)
      .order("hospital_code"),
  ]);
  const loadError = hosp.error ?? sheets.error;
  const hospitalMap = new Map((hosp.data ?? []).map((h) => [h.hospital_code, h]));
  const allSheets = (sheets.data ?? []);

  const rows: SheetRowData[] = allSheets.map((s) => {
    const h = hospitalMap.get(s.hospital_code);
    return {
      sheet_key: s.sheet_key,
      hospital_code: s.hospital_code,
      hospital_name: h?.hospital_name ?? "",
      district: h?.district ?? "",
      scheme: s.scheme,
      sheet_status: s.sheet_status,
      spreadsheet_id: s.spreadsheet_id,
      sheet_url: s.sheet_url,
      sync: s.sync,
      read_skip_reason: s.read_skip_reason,
      check_flag: s.check_flag,
      access_status: s.access_status,
      access_error: s.access_error,
      last_checked_at: s.last_checked_at,
      status: h?.status ?? "ACTIVE",
      needs_review: (h?.needs_review || s.needs_review) ?? false,
    };
  });

  const activeCount = rows.filter((r) => r.status === "ACTIVE").length;
  const referenceCount = rows.filter((r) => r.status === "REFERENCE").length;
  const accessOkCount = rows.filter((r) => r.access_status === "OK" && r.sync === "YES").length;
  const pendingCount = rows.filter((r) => r.access_status === "ACCESS_PENDING").length;

  const cards = [
    {
      label: "Hospitals & Schemes",
      value: rows.length,
      note: `${activeCount} ACTIVE · ${referenceCount} REFERENCE`,
      icon: icons.hospital,
      tone: "tone-blue",
    },
    {
      label: "Sheet Links",
      value: rows.filter((r) => r.sheet_url || r.spreadsheet_id).length,
      note: `SYNC ${rows.filter((s) => s.sync === "YES").length} YES · ${rows.filter((s) => s.sync === "HOLD").length} HOLD`,
      icon: icons.sheet,
      tone: "tone-green",
    },
    {
      label: "Robot Access",
      value: `${accessOkCount} OK`,
      note: `${pendingCount} pending / not shared`,
      icon: icons.alert,
      tone: pendingCount > 0 ? "tone-amber" : "tone-green",
    },
  ];

  return (
    <div className="stack">
      <PageHead
        title="Hospitals"
        subtitle="One row per hospital + scheme. Google sheet links, status, and read-only robot access."
        actions={
          <Link className="btn secondary" href="/admin/tabs">
            Sheet tabs (allow-list)
          </Link>
        }
      />

      {loadError && (
        <div className="notice warn" role="alert">
          <strong>Cannot load.</strong>
          <span>The Hospital Master tables could not be read (code {loadError.code}). Migration 0007 may not be applied yet.</span>
        </div>
      )}

      <div className="grid grid-3">
        {cards.map((c) => (
          <div key={c.label} className="card kpi">
            <span className={`icon ${c.tone}`}>{c.icon}</span>
            <div>
              <div className="value">{loadError ? "—" : c.value}</div>
              <div className="label">{c.label}</div>
              <div className="label">{c.note}</div>
            </div>
          </div>
        ))}
      </div>

      <HospitalTable initialRows={rows} canEdit={can(me?.role, "helper_work")} />
    </div>
  );
}

export default withTiming("/hospitals", HospitalsPage);
