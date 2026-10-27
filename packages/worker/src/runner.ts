// The free runner (D-065): a small process that takes QUEUED jobs one at a time, outside any
// web request (D-049, hard rule 13). Start it from the repo folder:
//   pnpm --filter @oksy/worker start          (keeps polling every 15 seconds)
//   pnpm --filter @oksy/worker once           (runs what is queued now, then stops)
// A later free scheduler (GitHub Actions cron or a Supabase schedule) only queues jobs.
// Prints job IDs, counts and milliseconds only; never a cell value or a key (hard rules 1, 10).
import { createReadPath, makeLogger, readClientsFromEnv, SheetNotReadableError, type GoogleEvent } from "@oksy/google";
import { suggestFromEnv } from "./ai-mapping.ts";
import { DbError, dbFromEnv, type Db } from "./db.ts";
import { RunStopped, runSheetJob, type Job } from "./sheet-run.ts";

export const MAX_ATTEMPTS = 3;

/** Temporary failures are retried (D-049); a stop on purpose is not. */
export function isRetryable(e: unknown): boolean {
  if (e instanceof RunStopped || e instanceof SheetNotReadableError) return false;
  if (e instanceof DbError) return /status (5\d\d|429)/.test(e.message);
  const code = (e as { code?: number }).code;
  return code === 429 || (typeof code === "number" && code >= 500) || /ECONNRESET|ETIMEDOUT|fetch failed/i.test(String(e));
}

/** Short error text for the jobs table: no values, no stack. */
export function safeError(e: unknown): string {
  const msg = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
  return msg.slice(0, 300);
}

export async function claimNext(db: Db): Promise<(Job & { attempts: number }) | null> {
  const [next] = await db.select<Job & { attempts: number }>(
    "jobs?status=eq.QUEUED&kind=eq.SHEET_RUN&order=requested_at&limit=1&select=id,sheet_key,mode,attempts",
  );
  if (!next) return null;
  await db.update(`jobs?id=eq.${next.id}&status=eq.QUEUED`, {
    status: "RUNNING",
    started_at: new Date().toISOString(),
    attempts: next.attempts + 1,
  });
  const [mine] = await db.select<{ status: string; attempts: number }>(`jobs?id=eq.${next.id}&select=status,attempts`);
  return mine?.status === "RUNNING" && mine.attempts === next.attempts + 1 ? { ...next, attempts: mine.attempts } : null;
}

export async function runOne(db: Db, job: Job & { attempts: number }): Promise<string> {
  const events: Array<GoogleEvent & { at: string }> = [];
  const read = createReadPath(readClientsFromEnv().sheets, makeLogger((e) => events.push(e)));
  const t = performance.now();
  try {
    const summary = await runSheetJob(job, {
      db,
      read,
      events,
      suggest: suggestFromEnv(),
      timing: (step, ms) => console.info(`[timing] job sheet-run ${step} ${ms}ms`),
    });
    const ok = summary.result === "WRITTEN" || summary.result === "DRY_RUN";
    await db.update(`jobs?id=eq.${job.id}`, {
      status: ok ? "SUCCEEDED" : "STOPPED",
      finished_at: new Date().toISOString(),
      summary: { ...summary, ms: { ...summary.ms, total: Math.round(performance.now() - t) } },
      error: ok ? null : summary.result,
    });
    return summary.result;
  } catch (e) {
    const retry = isRetryable(e) && job.attempts < MAX_ATTEMPTS;
    await db.update(`jobs?id=eq.${job.id}`, {
      status: retry ? "QUEUED" : "FAILED",
      finished_at: retry ? null : new Date().toISOString(),
      error: safeError(e),
    });
    return retry ? "RETRY" : "FAILED";
  } finally {
    console.info(`[timing] job sheet-run total ${Math.round(performance.now() - t)}ms`);
  }
}

async function main() {
  process.loadEnvFile(new URL("../../../apps/web/.env.local", import.meta.url).pathname);
  const db = dbFromEnv();
  const once = process.argv.includes("--once");
  console.info(`runner started (${once ? "once" : "polling every 15 s"})`);
  for (;;) {
    try {
      const job = await claimNext(db);
      if (job) {
        const result = await runOne(db, job);
        console.info(`job ${job.id.slice(0, 8)} ${job.sheet_key.split("|")[0]} ${job.mode}: ${result}`);
        continue;
      }
    } catch (e) {
      // One failed poll (database not reachable, migration not applied yet) never stops the runner.
      console.error(`poll failed: ${safeError(e)}`);
      if (once) process.exit(1);
    }
    if (once) break;
    await new Promise((r) => setTimeout(r, 15000));
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    console.error(`runner stopped: ${safeError(e)}`);
    process.exit(1);
  });
}
