"use server";

import { revalidatePath } from "next/cache";
import { can } from "@/lib/roles";
import { createClient, getMe } from "@/lib/supabase/server";

export type RunResult = { ok: boolean; message: string };

// "Run now" (D-049, D-065): only asks the database to queue a job for this one sheet. The
// database checks the role (ADMIN or APPROVER), SYNC = YES and that no run is waiting.
// The free runner (packages/worker) does the read; nothing long runs in this request.
export async function runNow(_prev: RunResult | null, form: FormData): Promise<RunResult> {
  const sheetKey = String(form.get("sheet_key") ?? "");
  const mode = form.get("mode") === "DRY_RUN" ? "DRY_RUN" : "WRITE";
  const supabase = await createClient();
  const { error } = await supabase.rpc("request_sheet_run", { p_sheet_key: sheetKey, p_mode: mode });
  if (error) return { ok: false, message: error.message };
  revalidatePath("/claims");
  return { ok: true, message: `Queued (${mode === "DRY_RUN" ? "check only, no write" : "read and write"}). The runner picks it up within 15 seconds.` };
}

export type JobStatus = {
  id: string;
  status: string;
  mode: string;
  error: string | null;
  result: string | null;
  layoutProblems: string[] | null;
  requestedAt: string;
  finishedAt: string | null;
};

// Polled from the browser every ~3s while a run for this sheet is queued or running (section
// 10: "run status is always visible", no manual refresh). Same read gate as the page itself.
export async function latestJobAction(sheetKey: string): Promise<JobStatus | null> {
  const me = await getMe();
  if (!can(me?.role, "see_cleaned_data")) return null;
  const supabase = await createClient();
  const { data } = await supabase
    .from("jobs")
    .select("id, status, mode, error, requested_at, finished_at, summary->result, summary->layoutProblems")
    .eq("sheet_key", sheetKey)
    .order("requested_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data) return null;
  const row = data as unknown as { id: string; status: string; mode: string; error: string | null; requested_at: string; finished_at: string | null; result: string | null; layoutProblems: string[] | null };
  return {
    id: row.id,
    status: row.status,
    mode: row.mode,
    error: row.error,
    result: row.result,
    layoutProblems: row.layoutProblems,
    requestedAt: row.requested_at,
    finishedAt: row.finished_at,
  };
}
