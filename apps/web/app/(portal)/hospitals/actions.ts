"use server";

import { revalidatePath } from "next/cache";
import { extractSpreadsheetId, previewHospitalList } from "@/lib/hospital-upload";
import { canEditHospitals } from "@/lib/roles";
import { createClient, getMe } from "@/lib/supabase/server";

export type HospitalActionResult = { ok: boolean; message: string; details?: string[] };

export async function saveHospitalProfileAction(
  _prev: HospitalActionResult | null,
  form: FormData
): Promise<HospitalActionResult> {
  const me = await getMe();
  if (!canEditHospitals(me)) {
    return { ok: false, message: "Only Owner, Admin or users with the Hospitals edit tick can edit hospital profiles." };
  }

  const hospitalKey = String(form.get("hospital_key") ?? "").trim();
  const hospitalCode = String(form.get("hospital_code") ?? "").trim().toUpperCase();
  const hospitalName = String(form.get("hospital_name") ?? "").trim();
  const otherNamesRaw = String(form.get("other_names") ?? "").trim();
  const status = String(form.get("status") ?? "ACTIVE").trim().toUpperCase();
  const questionSheetUrl = String(form.get("question_sheet_url") ?? "").trim() || null;
  const reason = String(form.get("reason") ?? "").trim() || null;

  if (!hospitalKey) return { ok: false, message: "Hospital key is required." };
  if (!hospitalCode) return { ok: false, message: "Hospital ID (code) is required." };
  if (!hospitalName) return { ok: false, message: "Hospital name is required." };

  const otherNames = otherNamesRaw
    ? otherNamesRaw.split(";").map((n) => n.trim()).filter(Boolean)
    : [];

  const supabase = await createClient();

  const { error } = await supabase.rpc("save_hospital_profile", {
    p_hospital_key: hospitalKey,
    p_new_hospital_code: hospitalCode,
    p_hospital_name: hospitalName,
    p_other_names: otherNames,
    p_status: status,
    p_question_sheet_url: questionSheetUrl,
    p_change_reason: reason,
  });

  if (error) {
    return { ok: false, message: `Could not save profile: ${error.message}` };
  }

  revalidatePath("/hospitals");
  return { ok: true, message: `Hospital ${hospitalCode} profile updated.` };
}

export async function saveHospitalSchemeAction(
  _prev: HospitalActionResult | null,
  form: FormData
): Promise<HospitalActionResult> {
  const me = await getMe();
  if (!canEditHospitals(me)) return { ok: false, message: "Only Owner, Admin or users with the Hospitals edit tick can manage hospitals." };

  const hospitalCode = String(form.get("hospital_code") ?? "").trim().toUpperCase();
  const hospitalName = String(form.get("hospital_name") ?? "").trim();
  const district = String(form.get("district") ?? "").trim().toUpperCase() || "UNKNOWN";
  const scheme = String(form.get("scheme") ?? "").trim().toUpperCase() || "PRIVATE";
  const sheetUrl = String(form.get("sheet_url") ?? "").trim();
  const status = String(form.get("status") ?? "ACTIVE").trim().toUpperCase();

  if (!hospitalCode) return { ok: false, message: "Hospital ID (code) is required." };
  if (!hospitalName) return { ok: false, message: "Hospital name is required." };

  const spreadsheetId = sheetUrl ? extractSpreadsheetId(sheetUrl) : null;
  const supabase = await createClient();

  const { error } = await supabase.rpc("save_hospital_scheme", {
    p_hospital_code: hospitalCode,
    p_hospital_name: hospitalName,
    p_district: district,
    p_scheme: scheme,
    p_sheet_url: sheetUrl || null,
    p_spreadsheet_id: spreadsheetId,
    p_status: status,
    p_sync: "YES",
  });

  if (error) {
    return { ok: false, message: `Could not save hospital: ${error.message}` };
  }

  revalidatePath("/hospitals");
  return { ok: true, message: `Hospital ${hospitalCode} (${scheme}) saved.` };
}

export async function setHospitalStatusAction(
  _prev: HospitalActionResult | null,
  form: FormData
): Promise<HospitalActionResult> {
  const me = await getMe();
  if (!canEditHospitals(me)) return { ok: false, message: "Only Owner, Admin or users with the Hospitals edit tick can change hospital status." };

  const hospitalCode = String(form.get("hospital_code") ?? "").trim();
  const status = String(form.get("status") ?? "INACTIVE").trim();

  if (!hospitalCode) return { ok: false, message: "Hospital ID is required." };

  const supabase = await createClient();
  const { error } = await supabase.rpc("set_hospital_status", {
    p_hospital_code: hospitalCode,
    p_status: status,
  });

  if (error) {
    return { ok: false, message: `Could not update status: ${error.message}` };
  }

  revalidatePath("/hospitals");
  return { ok: true, message: `Hospital ${hospitalCode} marked ${status}.` };
}

export async function triggerCheckAccessAction(): Promise<HospitalActionResult> {
  const me = await getMe();
  if (!canEditHospitals(me)) return { ok: false, message: "Only Owner, Admin or users with the Hospitals edit tick can check access." };

  try {
    const { spawn } = await import("child_process");
    const proc = spawn("pnpm", ["--filter", "@oksy/google", "check-access"], {
      detached: true,
      stdio: "ignore",
    });
    proc.unref();
    return { ok: true, message: "Access check started in background. Refresh in a few seconds to see updated statuses." };
  } catch (err: unknown) {
    return { ok: false, message: `Could not start check: ${err instanceof Error ? err.message : String(err)}` };
  }
}

/**
 * Hospital list upload (decision section 4, 27-Oct night): the browser shows the checked rows
 * first (previewHospitalList, nothing saved); this saves them. The file is checked again here; nothing is saved while any
 * row has a problem (correct the file and upload again). Each row goes through
 * save_hospital_scheme, which checks the Hospitals edit tick and writes the audit log.
 */
export async function saveHospitalListAction(text: string): Promise<HospitalActionResult> {
  const me = await getMe();
  if (!canEditHospitals(me)) {
    return { ok: false, message: "Only Owner, Admin or users with the Hospitals edit tick can upload hospital lists." };
  }
  const preview = previewHospitalList(text);
  if (preview.fileError) return { ok: false, message: preview.fileError };
  if (preview.errorCount > 0) return { ok: false, message: `Nothing saved: ${preview.errorCount} rows have problems. Correct the file and upload it again.` };

  const supabase = await createClient();
  let saved = 0;
  const failed: string[] = [];
  for (const r of preview.rows) {
    const { error } = await supabase.rpc("save_hospital_scheme", {
      p_hospital_code: r.hospitalCode,
      p_hospital_name: r.hospitalName,
      p_district: r.district,
      p_scheme: r.scheme,
      p_sheet_url: r.sheetUrl,
      p_spreadsheet_id: r.spreadsheetId,
      p_status: r.status,
      p_sync: "YES",
    });
    if (!error && (r.otherNames.length > 0 || r.questionSheetUrl)) {
      const extra = await supabase
        .from("hospitals")
        .update({ other_names: r.otherNames, question_sheet_url: r.questionSheetUrl })
        .eq("hospital_code", r.hospitalCode);
      if (extra.error) failed.push(`Row ${r.row} (${r.hospitalCode}): saved, but other names / Question Sheet link not saved: ${extra.error.message}`);
    }
    if (error) failed.push(`Row ${r.row} (${r.hospitalCode}): ${error.message}`);
    else saved++;
  }

  revalidatePath("/hospitals");
  return {
    ok: failed.length === 0,
    message: `Saved ${saved} of ${preview.rows.length} rows.${failed.length ? ` ${failed.length} problems below.` : ""}`,
    details: failed.slice(0, 10),
  };
}
