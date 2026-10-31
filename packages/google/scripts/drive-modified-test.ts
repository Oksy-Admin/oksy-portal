// Stage 1e (run by hand, never in CI): does every kind of edit change a sheet's Drive
// modifiedTime? Decides whether the 6 AM run may skip a sheet whose modifiedTime has not moved.
// Uses ONE new TEST sheet in the Question Sheets Shared Drive (never a hospital sheet),
// invented values only. Prints times and yes/no only.
//   node --import ./scripts/timing.ts scripts/drive-modified-test.ts            robot edits
//   node --import ./scripts/timing.ts scripts/drive-modified-test.ts --check    after a browser edit
//   node --import ./scripts/timing.ts scripts/drive-modified-test.ts --trash    move the test sheet to the trash
import { readFileSync, writeFileSync } from "node:fs";
import { drive as driveApi, auth as driveAuth } from "@googleapis/drive";
import { sheets as sheetsApi } from "@googleapis/sheets";
import { createWritePath, makeLogger, writeClientsFromEnv, WRITE_SCOPES } from "../src/index.ts";

process.loadEnvFile(new URL("../../../apps/web/.env.local", import.meta.url).pathname);
const STATE = new URL("../../../supabase/.temp/drive-modified-test.json", import.meta.url);
// The value in .env.local ends with a typed "\n" (two characters) on 31-Oct: cleaned here.
const folderId = (process.env.GOOGLE_QUESTION_SHEETS_FOLDER_ID ?? "").replace(/\\n$/, "").trim();
const log = makeLogger(() => {});
const { drive, sheets } = writeClientsFromEnv();
const path = createWritePath({ drive, sheets, questionSheetsFolderId: folderId, log });

// The same robot key, for modifiedTime and the formula / setting calls the write path does not
// need. Only used on the TEST sheet, after assertInFolder.
const key = JSON.parse(Buffer.from(process.env.GOOGLE_SERVICE_ACCOUNT_KEY_B64 ?? "", "base64").toString("utf8"));
const authed = new driveAuth.GoogleAuth({ credentials: { client_email: key.client_email, private_key: key.private_key }, scopes: WRITE_SCOPES });
const rawDrive = driveApi({ version: "v3", auth: authed });
const rawSheets = sheetsApi({ version: "v4", auth: authed });

const modified = async (id: string) => (await rawDrive.files.get({ fileId: id, fields: "modifiedTime", supportsAllDrives: true })).data.modifiedTime ?? "";
const wait = (s: number) => new Promise((r) => setTimeout(r, s * 1000));
const WAIT = 75; // Drive may update modifiedTime a little after the edit

const mode = process.argv[2] ?? "";
if (mode === "--check" || mode === "--trash") {
  const st = JSON.parse(readFileSync(STATE, "utf8")) as { id: string; last: string };
  await path.assertInFolder(st.id);
  if (mode === "--trash") {
    await path.trashSheet(st.id);
    console.log("test sheet moved to the trash");
  } else {
    const now = await modified(st.id);
    console.log(`browser edit | before ${st.last} | after ${now} | changed: ${now !== st.last ? "YES" : "NO"}`);
  }
} else {
  const id = await path.createSheet(`TEST - Oksy Drive modified-time check ${new Date().toISOString().slice(0, 10)} - safe to ignore`);
  await path.assertInFolder(id);
  const rows: string[] = [];
  let last = await modified(id);
  const step = async (name: string, act: () => Promise<unknown>, extraWait = 0) => {
    await act();
    await wait(WAIT + extraWait);
    const now = await modified(id);
    rows.push(`${name} | ${last} -> ${now} | changed: ${now !== last ? "YES" : "NO"}`);
    last = now;
  };
  await step("value typed in a cell (robot, API)", () => path.writeValues(id, "Sheet1!A1", [["fake value 1"]]));
  await step("formatting only (background colour)", () =>
    rawSheets.spreadsheets.batchUpdate({
      spreadsheetId: id,
      requestBody: {
        requests: [{ repeatCell: { range: { sheetId: 0, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: 1 }, cell: { userEnteredFormat: { backgroundColor: { red: 1, green: 0.9, blue: 0.6 } } }, fields: "userEnteredFormat.backgroundColor" } }],
      },
    }),
  );
  await step("formula =NOW() added, recalculation every minute switched on", () =>
    rawSheets.spreadsheets.batchUpdate({
      spreadsheetId: id,
      requestBody: {
        requests: [
          { updateCells: { start: { sheetId: 0, rowIndex: 0, columnIndex: 1 }, rows: [{ values: [{ userEnteredValue: { formulaValue: "=NOW()" } }] }], fields: "userEnteredValue" } },
          { updateSpreadsheetProperties: { properties: { autoRecalc: "MINUTE" }, fields: "autoRecalc" } },
        ],
      },
    }),
  );
  await step("nobody edits; =NOW() recalculates on its own (3 minutes)", async () => {}, 105);
  writeFileSync(STATE, JSON.stringify({ id, last }));
  console.log(rows.join("\n"));
  console.log(`test sheet: https://docs.google.com/spreadsheets/d/${id}/edit`);
}
