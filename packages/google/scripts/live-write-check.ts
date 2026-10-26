// One-off live check for M3 (run by hand, never in CI):
//   pnpm --filter @oksy/google live-write-check
// Uses the robot key and the Question Sheets Shared Drive ID (or a folder inside it) from
// apps/web/.env.local (never printed). Creates one clearly named TEST sheet there, writes
// two cells, protects the question columns for the robot only, confirms the location,
// shows that a non-sheet target is refused, then moves the test sheet to the trash.
// Touches no hospital sheet and changes no sharing.
import { createWritePath, makeLogger, robotEmailFromEnv, writeClientsFromEnv } from "../src/index.ts";

process.loadEnvFile(new URL("../../../apps/web/.env.local", import.meta.url).pathname);

// Names only, never values.
for (const name of ["GOOGLE_SERVICE_ACCOUNT_KEY_B64", "GOOGLE_QUESTION_SHEETS_FOLDER_ID"]) {
  console.log(`env ${name}: ${process.env[name] ? "set" : "MISSING"}`);
}
const folderId = process.env.GOOGLE_QUESTION_SHEETS_FOLDER_ID ?? "";

/** Google's reason code and HTTP status only: a full error object can carry request headers. */
function googleReason(e: unknown): string {
  const err = e as { code?: number; status?: number; errors?: Array<{ reason?: string }>; response?: { data?: { error?: { errors?: Array<{ reason?: string }>; status?: string } } } };
  const reason = err.errors?.[0]?.reason ?? err.response?.data?.error?.errors?.[0]?.reason ?? err.response?.data?.error?.status;
  return `${(e as Error).name}; status ${err.code ?? err.status ?? "?"}; reason ${reason ?? "(none, message: " + (e as Error).message + ")"}`;
}

const log = makeLogger((e) => console.log(JSON.stringify(e)));
let robot: string;
let path: ReturnType<typeof createWritePath>;
try {
  robot = robotEmailFromEnv();
  const { drive, sheets } = writeClientsFromEnv();
  path = createWritePath({ drive, sheets, questionSheetsFolderId: folderId, log });
  console.log(`robot key read OK: ${robot}`);
} catch (e) {
  console.log(`setup failed: ${(e as Error).message}`);
  process.exit(2);
}

const name = `TEST - Oksy robot write check ${new Date().toISOString()} - safe to ignore`;
let id: string;
try {
  id = await path.createSheet(name);
} catch (e) {
  console.log(`create failed: ${googleReason(e)}`);
  process.exit(2);
}

try {
  await path.writeValues(id, "A1:D1", [["Question (robot only)", "Detail (robot only)", "Row link (robot only)", "Staff answer (editable)"]]);
  await path.assertInFolder(id);
  const listed = await path.listSheets();
  console.log(`confirmed: test sheet is in the Question Sheets Shared Drive; listed there: ${listed.some((f) => f.id === id)}`);

  await path.protectColumns(id, { sheetId: 0, startColumnIndex: 0, endColumnIndex: 3, robotEmail: robot, description: "Oksy question columns (robot only)" });
  const prot = await path.listProtections(id);
  const staffCol = 3; // column D
  const staffProtected = prot.some((r) => staffCol >= (r.range?.startColumnIndex ?? 0) && staffCol < (r.range?.endColumnIndex ?? Infinity));
  for (const r of prot) {
    console.log(`protected: cols ${r.range?.startColumnIndex}-${(r.range?.endColumnIndex ?? 0) - 1}, warningOnly ${r.warningOnly}, editors ${(r.editors?.users ?? []).join(",")}`);
  }
  console.log(`staff column D protected: ${staffProtected} (expected false)`);
  if (staffProtected) process.exitCode = 1;

  try {
    await path.writeValues(folderId, "A1", [["must not be written"]]); // the drive or folder itself is not a sheet
    console.log("UNEXPECTED: write to a non-sheet target was not blocked");
    process.exitCode = 1;
  } catch (e) {
    console.log(`blocked as expected: ${(e as Error).name}`);
  }
} catch (e) {
  console.log(`step failed: ${googleReason(e)}`);
  process.exitCode = 2;
} finally {
  try {
    await path.trashSheet(id);
    console.log("done: test sheet moved to the trash (recoverable)");
  } catch (e) {
    console.log(`trash failed (test sheet left in place): ${googleReason(e)}`);
    process.exitCode = 2;
  }
}
