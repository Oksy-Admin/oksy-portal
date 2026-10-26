// Robot credentials from the environment only (hard rule 1). The key is decoded in memory
// and never logged, printed or written to disk. Each path gets its own scopes:
// the read path cannot write, whatever the code tries.
import { auth as driveAuth, drive } from "@googleapis/drive";
import { sheets } from "@googleapis/sheets";
import type { SheetsReader } from "./read.ts";
import type { DriveWriter, SheetsWriter } from "./write.ts";

export const READ_SCOPES = ["https://www.googleapis.com/auth/spreadsheets.readonly"];
export const WRITE_SCOPES = [
  "https://www.googleapis.com/auth/spreadsheets",
  "https://www.googleapis.com/auth/drive.file",
];

interface ServiceAccountKey {
  client_email: string;
  private_key: string;
}

function keyFromEnv(): ServiceAccountKey {
  const b64 = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_B64;
  if (!b64) throw new Error("GOOGLE_SERVICE_ACCOUNT_KEY_B64 is not set");
  let parsed: Partial<ServiceAccountKey>;
  try {
    parsed = JSON.parse(Buffer.from(b64, "base64").toString("utf8"));
  } catch {
    throw new Error("GOOGLE_SERVICE_ACCOUNT_KEY_B64 is not base64-encoded JSON"); // never echo the value
  }
  if (!parsed.client_email || !parsed.private_key) {
    throw new Error("GOOGLE_SERVICE_ACCOUNT_KEY_B64 has no client_email or private_key");
  }
  return { client_email: parsed.client_email, private_key: parsed.private_key };
}

/** The robot's email address (not a secret), to check the right account is used. */
export function robotEmailFromEnv(): string {
  return keyFromEnv().client_email;
}

function jwt(scopes: string[]) {
  const key = keyFromEnv();
  return new driveAuth.GoogleAuth({ credentials: key, scopes });
}

export function readClientsFromEnv(): { sheets: SheetsReader } {
  return { sheets: sheets({ version: "v4", auth: jwt(READ_SCOPES) }) as unknown as SheetsReader };
}

export function writeClientsFromEnv(): { drive: DriveWriter; sheets: SheetsWriter } {
  const a = jwt(WRITE_SCOPES);
  return {
    drive: drive({ version: "v3", auth: a }) as unknown as DriveWriter,
    sheets: sheets({ version: "v4", auth: a }) as unknown as SheetsWriter,
  };
}
