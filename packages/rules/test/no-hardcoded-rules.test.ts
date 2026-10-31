import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Stage 2a, decisions.md section 9 "rules are never hard-coded": a business-condition rule
// ID must never appear in clean.ts or the worker's sheet-run.ts code (comments may mention
// one freely). A few IDs are still allowed in code:
// - reading-level checks (engine.ts cannot express "is this cell readable at all", or "the
//   sheet's headers changed"); these are REFERENCE rows in initial-rules.ts, so they are
//   still listed with a title.
// - R-T01: the TDS default rate's own ID, used only as a fallback label when no rule
//   library data is loaded at all (DEFAULT_TDS); the rate itself is still a PARAMETER rule.
// - R-D06: tags the day-month swap AUTO-fix (lane 1, deterministic) in its Change record;
//   the Warning for when the swap does NOT resolve is still a real engine rule.
const CLEAN_TS_IDS = ["R-C01", "R-N02", "R-N05", "R-D04", "R-D05", "R-T01", "R-D06"];
const SHEET_RUN_TS_IDS = ["R-C01", "R-Y01"];

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}
function idsIn(path: string): { code: string; found: string[] } {
  const code = stripComments(readFileSync(new URL(path, import.meta.url), "utf8"));
  return { code, found: [...new Set([...code.matchAll(/R-[A-Z][0-9]{2}/g)].map((m) => m[0]))] };
}

describe("no rule ID is hard-coded in clean.ts", () => {
  const { code, found } = idsIn("../src/clean.ts");

  it("only the allowed (reading-level or fallback-label) rule IDs appear outside comments", () => {
    expect(found.filter((id) => !CLEAN_TS_IDS.includes(id))).toEqual([]);
  });
  it("every allowed ID is actually used (the list stays accurate)", () => {
    for (const id of CLEAN_TS_IDS) expect(code.includes(id)).toBe(true);
  });
});

describe("no rule ID is hard-coded in the worker's sheet-run.ts", () => {
  const { code, found } = idsIn("../../worker/src/sheet-run.ts");

  it("only R-C01 (excluding non-data rows from counts) and R-Y01 (header layout changed) appear", () => {
    expect(found.filter((id) => !SHEET_RUN_TS_IDS.includes(id))).toEqual([]);
  });
  it("both allowed IDs are actually used", () => {
    for (const id of SHEET_RUN_TS_IDS) expect(code.includes(id)).toBe(true);
  });
});
