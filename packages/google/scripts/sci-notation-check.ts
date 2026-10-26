// One-off check (run by hand, never in CI):
//   pnpm --filter @oksy/google sci-notation-check
// Question: when a long ID (claim no, UTR, policy no) sits in a cell as a NUMBER shown in
// scientific notation (1.23457E+11), can the robot recover the digits?
// Uses ONE new TEST sheet in the Question Sheets Shared Drive with invented numbers only
// (no hospital sheet), then moves it to the trash. Prints digits only, nothing personal.
import { sheets as sheetsApi } from "@googleapis/sheets";
import { auth as driveAuth } from "@googleapis/drive";
import { createWritePath, makeLogger, writeClientsFromEnv, READ_TAB_FIELDS, WRITE_SCOPES } from "../src/index.ts";

process.loadEnvFile(new URL("../../../apps/web/.env.local", import.meta.url).pathname);
const folderId = process.env.GOOGLE_QUESTION_SHEETS_FOLDER_ID ?? "";
const log = makeLogger((e) => console.log(JSON.stringify(e)));
const { drive, sheets } = writeClientsFromEnv();
const path = createWritePath({ drive, sheets, questionSheetsFolderId: folderId, log });

// The same robot key, used here for USER_ENTERED values and render options the write
// path does not need. Only touched after assertInFolder on the TEST sheet.
const key = JSON.parse(Buffer.from(process.env.GOOGLE_SERVICE_ACCOUNT_KEY_B64 ?? "", "base64").toString("utf8"));
const raw = sheetsApi({
  version: "v4",
  auth: new driveAuth.GoogleAuth({ credentials: { client_email: key.client_email, private_key: key.private_key }, scopes: WRITE_SCOPES }),
});

// Invented numbers of 12 to 19 digits, typed as a desk would type them.
const CASES = ["123456789012", "1234567890123", "12345678901234", "123456789012345", "1234567890123456", "1234567890123456789"];

const id = await path.createSheet(`TEST - Oksy scientific notation check ${new Date().toISOString()} - safe to ignore`);
try {
  await path.assertInFolder(id);
  await raw.spreadsheets.values.update({
    spreadsheetId: id,
    range: "A1:A6",
    valueInputOption: "USER_ENTERED",
    requestBody: { values: CASES.map((c) => [c]) },
  });
  await raw.spreadsheets.batchUpdate({
    spreadsheetId: id,
    requestBody: {
      requests: [
        {
          repeatCell: {
            range: { sheetId: 0, startRowIndex: 0, endRowIndex: 6, startColumnIndex: 0, endColumnIndex: 1 },
            cell: { userEnteredFormat: { numberFormat: { type: "SCIENTIFIC", pattern: "0.00000E+00" } } },
            fields: "userEnteredFormat.numberFormat",
          },
        },
      ],
    },
  });

  const fmt = await raw.spreadsheets.values.get({ spreadsheetId: id, range: "A1:A6", valueRenderOption: "FORMATTED_VALUE" });
  const unf = await raw.spreadsheets.values.get({ spreadsheetId: id, range: "A1:A6", valueRenderOption: "UNFORMATTED_VALUE" });
  // What the read path itself asks for (formattedValue and effectiveValue).
  const grid = await raw.spreadsheets.get({ spreadsheetId: id, ranges: ["A1:A6"], includeGridData: true, fields: READ_TAB_FIELDS });
  const eff = grid.data.sheets?.[0]?.data?.[0]?.rowData ?? [];

  console.log("digits | typed | FORMATTED_VALUE | UNFORMATTED_VALUE | read path effectiveValue | recovered exactly");
  CASES.forEach((c, i) => {
    const f = String(fmt.data.values?.[i]?.[0] ?? "");
    const u = unf.data.values?.[i]?.[0];
    const e = eff[i]?.values?.[0]?.effectiveValue?.numberValue;
    // Exact digits only if the number is a safe integer and prints back as typed.
    const uDigits = typeof u === "number" && Number.isSafeInteger(u) ? BigInt(u).toString() : String(u);
    console.log(`${c.length} | ${c} | ${f} | ${uDigits} | ${e == null ? "none" : Number.isSafeInteger(e) ? BigInt(e).toString() : String(e)} | ${uDigits === c}`);
  });
} finally {
  await path.trashSheet(id);
  console.log("done: TEST sheet moved to the trash (recoverable)");
}
