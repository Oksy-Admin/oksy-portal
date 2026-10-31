import Link from "next/link";
import { notFound } from "next/navigation";
import { canViewHospitals } from "@/lib/roles";
import { createClient, getMe } from "@/lib/supabase/server";
import { NoAccess, PageHead, Pill } from "../../ui";
import { AddDeskAccount, RemoveDeskAccount } from "./desk-forms";
import { withTiming } from "@/lib/timing";

// One hospital: register details, its sheets, other names, desk staff and the desk Google
// accounts its Question Sheet is shared with (D-048). The Hospitals view tick opens the page;
// staff phones and desk accounts are personal data, shown only where RLS allows them.
async function HospitalPage({ params }: { params: Promise<{ code: string }> }) {
  const me = await getMe();
  if (!canViewHospitals(me)) return <NoAccess title="Hospital" who="users with the Hospitals view tick" />;
  const { code } = await params;
  // Same limits as hospitals_hospital_code_check (3 to 32 characters); live IDs look like HOSPPVTP0001.
  if (!/^[A-Z0-9]{3,32}$/.test(code)) notFound();

  const supabase = await createClient();
  const { data: h } = await supabase
    .from("hospitals")
    .select("hospital_code, hospital_name, district, status, other_names, rohini_id, kasp_portal_name, medisep_portal_name, check_flag, remarks, missing_from_register_since")
    .eq("hospital_code", code).maybeSingle();
  if (!h) notFound();
  const [sheets, staff, desk, checks, heads, retired] = await Promise.all([
    supabase
      .from("hospital_sheets")
      .select("sheet_key, scheme, sheet_status, spreadsheet_id, sheet_url, sync, read_skip_reason, check_flag, access_status, access_error, last_checked_at")
      .eq("hospital_code", code).order("scheme"),
    supabase.from("staff_contacts").select("staff_name, designation, phone").eq("hospital_code", code).is("retired_at", null),
    supabase.from("desk_google_accounts").select("id, email, added_at").eq("hospital_code", code).is("removed_at", null).order("email"),
    supabase.from("open_checks").select("check_no, status, what_to_decide, decision").eq("hospital_code", code).order("check_no"),
    h.district ? supabase.from("district_heads").select("dbdo, rbdo").eq("district", h.district).maybeSingle() : Promise.resolve({ data: null }),
    supabase.from("retired_ids").select("retired_id, name_at_retirement").eq("kept_id", code),
  ]);

  return (
    <div className="stack">
      <p style={{ margin: 0 }}>
        <Link href="/hospitals">‹ Hospitals</Link>
      </p>
      <PageHead title={h.hospital_name} subtitle={`${h.hospital_code} · ${h.district ?? "district not given"}`} actions={<Pill value={h.status} />} />
      {h.missing_from_register_since && (
        <div className="notice warn">
          <strong>Not in the latest register.</strong>
          <span>Kept, not deleted. Marked on {new Date(h.missing_from_register_since).toLocaleDateString("en-IN")}.</span>
        </div>
      )}

      <div className="grid grid-3">
        <div className="card">
          <h2>Register</h2>
          <ul className="list-plain">
            <li>DBDO: {heads.data?.dbdo ?? "—"}</li>
            <li>RBDO: {heads.data?.rbdo ?? "—"}</li>
            <li>ROHINI ID: {h.rohini_id ?? "—"}</li>
            <li>KASP portal name: {h.kasp_portal_name ?? "—"}</li>
            <li>MEDISEP portal name: {h.medisep_portal_name ?? "—"}</li>
            {h.check_flag && <li>Flag: {h.check_flag}</li>}
            {h.remarks && <li>Remarks: {h.remarks}</li>}
            {(retired.data ?? []).map((r) => (
              <li key={r.retired_id}>
                Merged from {r.retired_id} ({r.name_at_retirement})
              </li>
            ))}
          </ul>
        </div>
        <div className="card">
          <h2>Other names</h2>
          {/* hospitals.other_names (decision 27-Oct); the old hospital_aliases table is retired. */}
          {h.other_names?.length ? (
            <ul className="list-plain">
              {h.other_names.map((name: string) => (
                <li key={name}>{name}</li>
              ))}
            </ul>
          ) : (
            <p className="muted">None.</p>
          )}
        </div>
        <div className="card">
          <h2>Desk staff (register)</h2>
          {staff.data?.length ? (
            <ul className="list-plain">
              {staff.data.map((s) => (
                <li key={s.staff_name}>
                  {s.staff_name}
                  {s.designation ? `, ${s.designation}` : ""} {s.phone && <span className="muted">· {s.phone}</span>}
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">None in the register.</p>
          )}
        </div>
      </div>

      <div className="card table-wrap" style={{ padding: 0 }}>
        <table className="data">
          <thead>
            <tr>
              <th>Scheme</th>
              <th>Sheet</th>
              <th>Sheet status</th>
              <th>SYNC</th>
              <th>Access</th>
              <th>Last checked</th>
              <th>Note</th>
            </tr>
          </thead>
          <tbody>
            {(sheets.data ?? []).map((s) => (
              <tr key={s.sheet_key}>
                <td>{s.scheme}</td>
                <td>
                  {s.sheet_url ? (
                    <a href={s.sheet_url} target="_blank" rel="noreferrer">
                      …{String(s.spreadsheet_id).slice(-6)} ↗
                    </a>
                  ) : (
                    "—"
                  )}
                </td>
                <td>{s.sheet_status}</td>
                <td>
                  <Pill value={s.sync} />
                </td>
                <td title={s.access_error ?? ""}>
                  <Pill value={s.sync !== "YES" || s.read_skip_reason ? "NOT READ" : s.access_status} />
                </td>
                <td className="muted">{s.last_checked_at ? new Date(s.last_checked_at).toLocaleString("en-IN") : "—"}</td>
                <td className="muted">{s.read_skip_reason ?? s.access_error ?? s.check_flag ?? ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card">
        <h2>Desk Google accounts (Question Sheet sharing, D-048)</h2>
        <p className="muted" style={{ marginTop: 0 }}>
          The Question Sheet is shared only with these named accounts, never &quot;anyone with the link&quot;. Saving here
          does not change sharing: a helper shares the sheet in Google Drive.
        </p>
        {desk.data?.length ? (
          <table className="data" style={{ marginBottom: 12 }}>
            <tbody>
              {desk.data.map((d) => (
                <tr key={d.id}>
                  <td>{d.email}</td>
                  <td className="muted">added {new Date(d.added_at).toLocaleDateString("en-IN")}</td>
                  <td>
                    <RemoveDeskAccount id={d.id} hospitalCode={code} email={d.email} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="muted">No desk accounts yet.</p>
        )}
        <AddDeskAccount hospitalCode={code} />
      </div>

      {!!checks.data?.length && (
        <div className="card">
          <h2>Register open checks</h2>
          <ul className="list-plain">
            {checks.data.map((c) => (
              <li key={c.check_no}>
                #{c.check_no} <Pill value={c.status} /> {c.what_to_decide}
                {c.decision ? ` — ${c.decision}` : ""}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export default withTiming("/hospitals/[code]", HospitalPage);
