"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export type RunNowScope = "ALL" | "HOSPITAL" | "SHEET";
export type RunNowResult = { ok: boolean; message: string };

// Stage 3 runs read the sheet, find month tabs, propose the column mapping and count
// non-data rows. They write no clean data until the cleaning engine (Stage 4) is approved.
const STAGE3_MODE = "DRY_RUN";

// Run now at three levels (requirements v2 section 4). Only asks the database to queue
// jobs; the runner (packages/worker) does the read. Every approved user may press it
// (addendum 27-Oct-2026): the database checks that, and refuses a second run of a sheet
// that is already queued or running.
export async function runNowAction(_prev: RunNowResult | null, form: FormData): Promise<RunNowResult> {
  const scope = String(form.get("scope") ?? "") as RunNowScope;
  const supabase = await createClient();

  if (scope === "SHEET") {
    const sheetKey = String(form.get("sheet_key") ?? "");
    const { error } = await supabase.rpc("request_sheet_run", { p_sheet_key: sheetKey, p_mode: STAGE3_MODE });
    if (error) return { ok: false, message: error.code === "23505" ? "Running: this sheet is already queued or running." : error.message };
    revalidatePath("/", "layout");
    return { ok: true, message: `Queued ${sheetKey.split("|").join(" ")}.` };
  }

  if (scope !== "ALL" && scope !== "HOSPITAL") return { ok: false, message: "Unknown Run now scope." };
  const hospitalCode = scope === "HOSPITAL" ? String(form.get("hospital_code") ?? "") : null;
  const { data, error } = await supabase.rpc("request_runs", { p_scope: scope, p_hospital_code: hospitalCode, p_mode: STAGE3_MODE });
  if (error) {
    // request_runs comes with migration 20261027000026 (not applied until Anoop approves it).
    if (error.code === "PGRST202") return { ok: false, message: "Run now for all hospitals or one hospital needs database update 0026 (waiting for approval)." };
    return { ok: false, message: error.message };
  }
  const rows = (data ?? []) as Array<{ sheet_key: string; result: string }>;
  const count = (r: string) => rows.filter((x) => x.result === r).length;
  revalidatePath("/", "layout");
  if (rows.length === 0) return { ok: false, message: "No sheet to read (no active hospital with a linked sheet set to SYNC YES)." };
  const parts = [`${count("QUEUED")} queued`];
  if (count("ALREADY_RUNNING")) parts.push(`${count("ALREADY_RUNNING")} already running`);
  if (count("NOT_READ")) parts.push(`${count("NOT_READ")} not read`);
  return { ok: count("QUEUED") > 0 || count("ALREADY_RUNNING") > 0, message: `Run now: ${parts.join(", ")}.` };
}

/** Sheet keys with a run queued or running now (for the "Running" state of the buttons). */
export async function activeSheetRuns(): Promise<string[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("active_sheet_runs");
  if (!error) return ((data ?? []) as Array<{ sheet_key: string }>).map((r) => r.sheet_key);
  // Before migration 0026: Owner and Admin can still read jobs directly.
  const jobs = await supabase.from("jobs").select("sheet_key").in("status", ["QUEUED", "RUNNING"]);
  return (jobs.data ?? []).map((j) => j.sheet_key as string);
}
