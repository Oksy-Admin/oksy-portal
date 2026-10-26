"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

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
