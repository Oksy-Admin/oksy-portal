import Link from "next/link";
import { canEditHospitals, canViewHospitals } from "@/lib/roles";
import { createClient, getMe } from "@/lib/supabase/server";
import { icons } from "../icons";
import { NoAccess, PageHead } from "../ui";
import { HospitalTable, type HospitalRowData } from "./hospital-table";
import { activeSheetRuns } from "../run-now-actions";
import { withTiming } from "@/lib/timing";

async function HospitalsPage() {
  const me = await getMe();
  // The hospitals_view tick (Owner and Admin always); editing needs hospitals_add_edit.
  if (!canViewHospitals(me)) return <NoAccess title="Hospitals" who="users with the Hospitals view tick" />;

  const supabase = await createClient();
  const [hosp, sheets, running] = await Promise.all([
    supabase
      .from("hospitals")
      .select("hospital_key, hospital_code, hospital_name, district, status, other_names, question_sheet_url, missing_from_register_since")
      .is("missing_from_register_since", null)
      .order("hospital_code"),
    supabase
      .from("hospital_sheets")
      .select("sheet_key, hospital_code, scheme, sheet_status, spreadsheet_id, sheet_url, sync, read_skip_reason, check_flag, access_status, access_error, last_checked_at, last_ok_at")
      .is("missing_from_register_since", null)
      .order("hospital_code"),
    activeSheetRuns(),
  ]);

  const loadError = hosp.error ?? sheets.error;
  const hospitalList = hosp.data ?? [];
  const allSheets = sheets.data ?? [];

  // Group sheets by hospital_code
  const sheetsByHospital = new Map<string, typeof allSheets>();
  for (const s of allSheets) {
    const list = sheetsByHospital.get(s.hospital_code) ?? [];
    list.push(s);
    sheetsByHospital.set(s.hospital_code, list);
  }

  const rows: HospitalRowData[] = hospitalList.map((h) => {
    const hospitalSheets = sheetsByHospital.get(h.hospital_code) ?? [];
    return {
      hospital_key: h.hospital_key,
      hospital_code: h.hospital_code,
      hospital_name: h.hospital_name,
      district: h.district ?? "",
      status: h.status,
      other_names: Array.isArray(h.other_names) ? h.other_names : [],
      question_sheet_url: h.question_sheet_url ?? null,
      schemes: hospitalSheets.map((s) => ({
        sheet_key: s.sheet_key,
        scheme: s.scheme,
        spreadsheet_id: s.spreadsheet_id,
        sheet_url: s.sheet_url,
        sheet_status: s.sheet_status,
        sync: s.sync,
        access_status: s.access_status,
        access_error: s.access_error,
        last_checked_at: s.last_checked_at,
        last_ok_at: s.last_ok_at,
      })),
    };
  });

  const activeCount = rows.filter((r) => r.status === "ACTIVE").length;
  const stoppedCount = rows.filter((r) => r.status === "STOPPED" || r.status === "INACTIVE").length;
  const totalSheets = allSheets.length;
  const linkedSheets = allSheets.filter((s) => s.sheet_url || s.spreadsheet_id).length;
  const syncYesCount = allSheets.filter((s) => s.sync === "YES").length;
  const syncHoldCount = allSheets.filter((s) => s.sync === "HOLD").length;
  const accessOkCount = allSheets.filter((s) => s.access_status === "OK").length;
  const accessPendingCount = allSheets.filter((s) => s.access_status === "ACCESS_PENDING" || s.access_status === "NOT_CHECKED").length;
  const questionSheetCount = rows.filter((r) => r.question_sheet_url).length;

  const cards = [
    {
      label: "Hospitals",
      value: rows.length,
      note: `${activeCount} ACTIVE · ${stoppedCount} STOPPED`,
      icon: icons.hospital,
      tone: "tone-blue",
    },
    {
      label: "Scheme Sheets Linked",
      value: `${linkedSheets} / ${totalSheets}`,
      note: `SYNC ${syncYesCount} YES · ${syncHoldCount} HOLD`,
      icon: icons.sheet,
      tone: "tone-green",
    },
    {
      label: "Robot Access",
      value: `${accessOkCount} OK`,
      note: `${accessPendingCount} pending / not checked`,
      icon: icons.alert,
      tone: accessPendingCount > 0 ? "tone-amber" : "tone-green",
    },
    {
      label: "Question Sheets",
      value: `${questionSheetCount} Created`,
      note: `${rows.length - questionSheetCount} not created`,
      icon: icons.sheet,
      tone: "tone-blue",
    },
  ];

  return (
    <div className="stack">
      <PageHead
        title="Hospitals"
        subtitle="Hospital profiles, editable IDs and names, scheme sheets, and read-only robot access."
        actions={
          <Link className="btn secondary" href="/admin/tabs">
            Sheet tabs (allow-list)
          </Link>
        }
      />

      {loadError && (
        <div className="notice warn" role="alert">
          <strong>Cannot load.</strong>
          <span>The Hospital Master tables could not be read (code {loadError.code}): {loadError.message}</span>
        </div>
      )}

      <div className="grid grid-4">
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

      <HospitalTable initialRows={rows} canEdit={canEditHospitals(me)} running={running} />
    </div>
  );
}

export default withTiming("/hospitals", HospitalsPage);
