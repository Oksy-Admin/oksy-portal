"use server";

import { revalidatePath } from "next/cache";
import { canEditHospitals } from "@/lib/roles";
import { createClient, getMe } from "@/lib/supabase/server";

export type HospitalActionResult = { ok: boolean; message: string; details?: string[] };

function extractSpreadsheetId(urlOrId: string): string | null {
  const trimmed = urlOrId.trim();
  if (!trimmed) return null;
  const match = trimmed.match(/\/d\/([a-zA-Z0-9-_]+)/);
  if (match && match[1]) return match[1];
  if (/^[a-zA-Z0-9-_]{20,}$/.test(trimmed)) return trimmed;
  return null;
}

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

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentVal = "";
  let insideQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const nextChar = text[i + 1];

    if (char === '"') {
      if (insideQuotes && nextChar === '"') {
        currentVal += '"';
        i++;
      } else {
        insideQuotes = !insideQuotes;
      }
    } else if (char === ',' && !insideQuotes) {
      currentRow.push(currentVal.trim());
      currentVal = "";
    } else if ((char === '\r' || char === '\n') && !insideQuotes) {
      if (char === '\r' && nextChar === '\n') i++;
      currentRow.push(currentVal.trim());
      if (currentRow.some((c) => c.length > 0)) {
        rows.push(currentRow);
      }
      currentRow = [];
      currentVal = "";
    } else {
      currentVal += char;
    }
  }
  if (currentVal || currentRow.length > 0) {
    currentRow.push(currentVal.trim());
    if (currentRow.some((c) => c.length > 0)) {
      rows.push(currentRow);
    }
  }
  return rows;
}

export async function uploadHospitalListAction(
  _prev: HospitalActionResult | null,
  form: FormData
): Promise<HospitalActionResult> {
  const me = await getMe();
  if (!canEditHospitals(me)) {
    return { ok: false, message: "Only Owner, Admin or users with the Hospitals edit tick can upload hospital lists." };
  }

  const file = form.get("csv_file") as File | null;
  if (!file || file.size === 0) {
    return { ok: false, message: "Please select a CSV file to upload." };
  }

  const text = await file.text();
  const parsed = parseCsv(text);
  if (parsed.length < 2 || !parsed[0]) {
    return { ok: false, message: "The CSV file must contain a header row and at least one data row." };
  }

  const headerRow = parsed[0];
  const dataRows = parsed.slice(1);
  const headerMap = new Map<string, number>();
  headerRow.forEach((h, idx) => {
    headerMap.set(h.toLowerCase().replace(/[^a-z0-9]/g, ""), idx);
  });

  const getCol = (row: string[] | undefined, ...names: string[]): string => {
    if (!row) return "";
    for (const name of names) {
      const idx = headerMap.get(name.toLowerCase().replace(/[^a-z0-9]/g, ""));
      if (idx !== undefined && row[idx] !== undefined) return row[idx].trim();
    }
    return "";
  };

  const supabase = await createClient();
  let accepted = 0;
  let rejected = 0;
  const rejectionDetails: string[] = [];

  for (let i = 0; i < dataRows.length; i++) {
    const row = dataRows[i];
    const rowNum = i + 2;

    const hospitalCode = getCol(row, "Hospital ID", "Hospital Code", "ID").toUpperCase();
    const hospitalName = getCol(row, "Hospital Name", "Name");
    const otherNamesRaw = getCol(row, "Other Names", "Aliases");
    const statusRaw = getCol(row, "Status").toUpperCase() || "ACTIVE";
    const status = statusRaw === "STOPPED" || statusRaw === "INACTIVE" ? "STOPPED" : "ACTIVE";
    const schemeRaw = getCol(row, "Scheme").toUpperCase() || "PRIVATE";
    const scheme = schemeRaw.includes("KASP") ? "KASP" : schemeRaw.includes("MEDISEP") ? "MEDISEP" : "PRIVATE";
    const sheetUrl = getCol(row, "Google Sheet Link", "Sheet Link", "Sheet URL");
    const questionSheetUrl = getCol(row, "Question Sheet Link", "Question Sheet URL") || null;

    if (!hospitalCode) {
      rejected++;
      rejectionDetails.push(`Row ${rowNum}: Hospital ID is required.`);
      continue;
    }
    if (!hospitalName) {
      rejected++;
      rejectionDetails.push(`Row ${rowNum} (${hospitalCode}): Hospital Name is required.`);
      continue;
    }
    if (!sheetUrl) {
      rejected++;
      rejectionDetails.push(`Row ${rowNum} (${hospitalCode}): Google Sheet Link is required.`);
      continue;
    }

    const spreadsheetId = extractSpreadsheetId(sheetUrl);
    if (!spreadsheetId) {
      rejected++;
      rejectionDetails.push(`Row ${rowNum} (${hospitalCode}): Invalid Google Sheet link.`);
      continue;
    }

    const otherNames = otherNamesRaw
      ? otherNamesRaw.split(";").map((n) => n.trim()).filter(Boolean)
      : [];

    // 1. Upsert hospital
    const { error: hospErr } = await supabase.from("hospitals").upsert(
      {
        hospital_code: hospitalCode,
        hospital_name: hospitalName,
        other_names: otherNames,
        status: status,
        question_sheet_url: questionSheetUrl,
        district: "UNKNOWN",
        updated_at: new Date().toISOString(),
      },
      { onConflict: "hospital_code" }
    );

    if (hospErr) {
      rejected++;
      rejectionDetails.push(`Row ${rowNum} (${hospitalCode}): Database error - ${hospErr.message}`);
      continue;
    }

    // 2. Upsert hospital_sheets
    const sheetKey = `${hospitalCode}|${scheme}`;
    const { error: sheetErr } = await supabase.from("hospital_sheets").upsert(
      {
        sheet_key: sheetKey,
        hospital_code: hospitalCode,
        scheme: scheme,
        sheet_status: "LINKED",
        spreadsheet_id: spreadsheetId,
        sheet_url: sheetUrl,
        sync: "YES",
        access_status: "NOT_CHECKED",
        updated_at: new Date().toISOString(),
      },
      { onConflict: "sheet_key" }
    );

    if (sheetErr) {
      rejected++;
      rejectionDetails.push(`Row ${rowNum} (${hospitalCode}): Sheet error - ${sheetErr.message}`);
      continue;
    }

    accepted++;
  }

  // Record upload batch in audit_log
  await supabase.from("audit_log").insert({
    actor_user_id: me?.userId ?? null,
    actor_email: me?.email ?? null,
    action: "UPLOAD",
    table_name: "hospitals",
    record_id: file.name || "hospital_list_upload.csv",
    before: null,
    after: {
      file_name: file.name || "hospital_list_upload.csv",
      total_rows: dataRows.length,
      accepted_rows: accepted,
      rejected_rows: rejected,
    },
    reason: `Bulk upload hospital list: ${accepted} accepted, ${rejected} rejected`,
  });

  revalidatePath("/hospitals");

  return {
    ok: accepted > 0,
    message: `Upload complete: ${accepted} accepted, ${rejected} rejected.`,
    details: rejectionDetails.slice(0, 10),
  };
}
