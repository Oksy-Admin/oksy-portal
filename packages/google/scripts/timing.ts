// Timing log (S0) for every script: loaded with `node --import` (see package.json), so the
// scripts themselves are unchanged. Prints the job name and total milliseconds only.
import { basename } from "node:path";

const startedAt = performance.now();
const job = basename(process.argv[1] ?? "script", ".ts");
process.on("exit", (code) => {
  console.info(`[timing] job ${job} ${Math.round(performance.now() - startedAt)}ms (exit ${code})`);
});
