// Multi-sheet runner (file 04 section 5.2 S3, D-065):
// Runs all accessible PRIVATE sheets with concurrency limit (3 to 5).
// For each sheet: auto-discovers tabs, records layouts/version groups, maps headers,
// normalises, validates rules, reconciles (0 unexplained differences), and writes staging.
import { createReadPath, makeLogger, readClientsFromEnv, type GoogleEvent } from "@oksy/google";
import { suggestFromEnv } from "./ai-mapping.ts";
import { dbFromEnv, type Db } from "./db.ts";
import { runSheetJob, type Job, type RunSummary } from "./sheet-run.ts";

export interface MultiRunOptions {
  concurrency?: number;
  mode?: "WRITE" | "DRY_RUN";
  sheetKeys?: string[];
}

export interface SheetRunOutcome {
  sheet_key: string;
  hospital_code: string;
  spreadsheet_id: string;
  status: "SUCCEEDED" | "DRY_RUN" | "SKIPPED_NO_ALLOW_TABS" | "STOPPED" | "FAILED";
  tabsRead: string[];
  tabsSkipped: Array<{ tab: string; policy: string }>;
  claimsWritten?: number;
  paymentsWritten?: number;
  reconciliationResult: "PASS" | "FAIL";
  unexplainedDifferences: number;
  durationMs: number;
  error?: string;
}

export async function runAllAccessiblePrivateSheets(
  db: Db,
  options: MultiRunOptions = {}
): Promise<{ outcomes: SheetRunOutcome[]; totalDurationMs: number }> {
  const concurrency = Math.max(1, Math.min(5, options.concurrency ?? 3));
  const mode = options.mode ?? "WRITE";
  const startAll = performance.now();

  // 1. Fetch accessible PRIVATE sheets
  let query = "hospital_sheets?scheme=eq.PRIVATE&sync=eq.YES&access_status=eq.OK&read_skip_reason=is.null&missing_from_register_since=is.null&select=sheet_key,hospital_code,spreadsheet_id,access_status&order=hospital_code";
  const sheets = await db.select<{ sheet_key: string; hospital_code: string; spreadsheet_id: string; access_status: string }>(query);

  const targets = options.sheetKeys && options.sheetKeys.length > 0
    ? sheets.filter((s) => options.sheetKeys!.includes(s.sheet_key))
    : sheets;

  console.info(`[multi-runner] Target accessible PRIVATE sheets: ${targets.length} (concurrency: ${concurrency}, mode: ${mode})`);

  const outcomes: SheetRunOutcome[] = [];

  // Concurrency pool runner
  let index = 0;
  async function worker(workerId: number) {
    while (index < targets.length) {
      const curIndex = index++;
      const s = targets[curIndex];
      if (!s) break;

      const t0 = performance.now();
      console.info(`[multi-runner][w${workerId}] Starting ${s.hospital_code} (${s.sheet_key}) [${curIndex + 1}/${targets.length}]`);

      // Claim an existing queued job or use a generated execution ID
      let [job] = await db.select<{ id: string }>(
        `jobs?sheet_key=eq.${encodeURIComponent(s.sheet_key)}&status=eq.QUEUED&limit=1&select=id`
      );
      const jobId = job ? job.id : crypto.randomUUID();
      if (job) {
        await db.update(`jobs?id=eq.${jobId}`, {
          status: "RUNNING",
          started_at: new Date().toISOString(),
        });
      }

      const events: Array<GoogleEvent & { at: string }> = [];
      const read = createReadPath(readClientsFromEnv().sheets, makeLogger((e) => events.push(e)));

      try {
        const summary: RunSummary = await runSheetJob(
          { id: jobId, sheet_key: s.sheet_key, mode },
          { db, read, events, suggest: suggestFromEnv() }
        );

        const ok = summary.result === "WRITTEN" || summary.result === "DRY_RUN";
        const skippedNoAllow = summary.tabsRead.length === 0 && summary.tabsSkipped.length > 0;
        const duration = Math.round(performance.now() - t0);

        if (job) {
          await db.update(`jobs?id=eq.${jobId}`, {
            status: ok ? "SUCCEEDED" : "STOPPED",
            finished_at: new Date().toISOString(),
            summary: { ...summary, ms: { ...summary.ms, total: duration } },
            error: ok ? null : summary.result,
          });
        }

        const outcome: SheetRunOutcome = {
          sheet_key: s.sheet_key,
          hospital_code: s.hospital_code,
          spreadsheet_id: s.spreadsheet_id,
          status: skippedNoAllow ? "SKIPPED_NO_ALLOW_TABS" : summary.result === "WRITTEN" ? "SUCCEEDED" : "DRY_RUN",
          tabsRead: summary.tabsRead,
          tabsSkipped: summary.tabsSkipped,
          claimsWritten: summary.sync?.new ?? summary.reconciliation.counts.sourceRows,
          paymentsWritten: summary.payments,
          reconciliationResult: summary.reconciliation.result,
          unexplainedDifferences: summary.reconciliation.differences.length,
          durationMs: duration,
        };
        outcomes.push(outcome);
        console.info(`[multi-runner][w${workerId}] Completed ${s.hospital_code}: ${outcome.status} (${duration}ms)`);
      } catch (err) {
        const duration = Math.round(performance.now() - t0);
        const errMsg = err instanceof Error ? err.message : String(err);
        if (job) {
          await db.update(`jobs?id=eq.${jobId}`, {
            status: "FAILED",
            finished_at: new Date().toISOString(),
            error: errMsg.slice(0, 300),
          });
        }

        outcomes.push({
          sheet_key: s.sheet_key,
          hospital_code: s.hospital_code,
          spreadsheet_id: s.spreadsheet_id,
          status: "FAILED",
          tabsRead: [],
          tabsSkipped: [],
          reconciliationResult: "FAIL",
          unexplainedDifferences: 1,
          durationMs: duration,
          error: errMsg,
        });
        console.error(`[multi-runner][w${workerId}] Failed ${s.hospital_code}: ${errMsg} (${duration}ms)`);
      }
    }
  }

  const workers = Array.from({ length: concurrency }, (_, i) => worker(i + 1));
  await Promise.all(workers);

  const totalDurationMs = Math.round(performance.now() - startAll);
  console.info(`[multi-runner] All ${targets.length} sheets finished in ${totalDurationMs}ms`);
  return { outcomes, totalDurationMs };
}
