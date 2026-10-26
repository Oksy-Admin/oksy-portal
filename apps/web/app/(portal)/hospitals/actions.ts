"use server";

import { revalidatePath } from "next/cache";
import { can } from "@/lib/roles";
import { createClient, getMe } from "@/lib/supabase/server";

export type HospitalActionResult = { ok: boolean; message: string };

function extractSpreadsheetId(urlOrId: string): string | null {
  const trimmed = urlOrId.trim();
  if (!trimmed) return null;
  const match = trimmed.match(/\/d\/([a-zA-Z0-9-_]+)/);
  if (match && match[1]) return match[1];
  if (/^[a-zA-Z0-9-_]{20,}$/.test(trimmed)) return trimmed;
  return null;
}

export async function saveHospitalSchemeAction(
  _prev: HospitalActionResult | null,
  form: FormData
): Promise<HospitalActionResult> {
  const me = await getMe();
  if (!can(me?.role, "helper_work")) return { ok: false, message: "Only HELPER, APPROVER or ADMIN can manage hospitals." };

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
  if (!can(me?.role, "helper_work")) return { ok: false, message: "Only HELPER, APPROVER or ADMIN can change hospital status." };

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
  if (!can(me?.role, "helper_work")) return { ok: false, message: "Only HELPER, APPROVER or ADMIN can check access." };

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

