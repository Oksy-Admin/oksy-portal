import { describe, expect, it } from "vitest";
import { extractSpreadsheetId, previewHospitalList, UPLOAD_MAX_ROWS } from "./hospital-upload";

// Hospital list upload preview (Stage 1c). Invented hospitals and sheet IDs only.
const HEAD = "Hospital ID,Hospital Name,Other Names,Status,Scheme,Google Sheet Link,Question Sheet Link";
const URL1 = "https://docs.google.com/spreadsheets/d/FAKEsheetUPLOAD000000000000001/edit";
const URL2 = "https://docs.google.com/spreadsheets/d/FAKEsheetUPLOAD000000000000002/edit";

describe("hospital list upload: preview before save", () => {
  it("good rows are read with their names, scheme and sheet ID", () => {
    const p = previewHospitalList(`${HEAD}\nHOSPTEST0001,"Test Hospital, One","Test One; T1",Active,Private,${URL1},\nhosptest0002,Test Two,,Stopped,KASP,${URL2},`);
    expect(p.fileError).toBeNull();
    expect(p.errorCount).toBe(0);
    expect(p.rows.map((r) => [r.row, r.hospitalCode, r.hospitalName, r.otherNames, r.status, r.scheme, r.spreadsheetId])).toEqual([
      [2, "HOSPTEST0001", "Test Hospital, One", ["Test One", "T1"], "ACTIVE", "PRIVATE", "FAKEsheetUPLOAD000000000000001"],
      [3, "HOSPTEST0002", "Test Two", [], "STOPPED", "KASP", "FAKEsheetUPLOAD000000000000002"],
    ]);
  });

  it("every problem is shown on its row; nothing is guessed", () => {
    const p = previewHospitalList(
      `${HEAD}\n,No ID,,Active,Private,${URL1},\nHOSPTEST0003,,,Paused,Private,not a link,\nHOSPTEST0004,Test Four,,Active,Insurance,,\nHOSPTEST0005,Five,,Active,Private,${URL1},\nHOSPTEST0005,Five again,,Active,Private,${URL2},`,
    );
    expect(p.errorCount).toBe(4);
    expect(p.rows.map((r) => r.errors)).toEqual([
      ["Hospital ID is missing."],
      ["Hospital Name is missing.", 'Status "Paused" is not Active or Stopped.', "Google Sheet Link is not a Google Sheet address."],
      ['Scheme "Insurance" is not Private, KASP or MEDISEP.', "Google Sheet Link is missing."],
      [],
      ["Same Hospital ID and Scheme as row 5."],
    ]);
  });

  it("file-level problems stop the preview", () => {
    expect(previewHospitalList(HEAD).fileError).toContain("at least one data row");
    expect(previewHospitalList("Name,Link\nA,B").fileError).toContain("Hospital ID and Hospital Name");
    const many = [HEAD, ...Array.from({ length: UPLOAD_MAX_ROWS + 1 }, (_, i) => `HOSPTEST${i},Test,,Active,Private,${URL1},`)].join("\n");
    expect(previewHospitalList(many).fileError).toContain(`At most ${UPLOAD_MAX_ROWS} rows`);
  });

  it("sheet links and bare IDs", () => {
    expect(extractSpreadsheetId(URL1)).toBe("FAKEsheetUPLOAD000000000000001");
    expect(extractSpreadsheetId("FAKEsheetUPLOAD000000000000001")).toBe("FAKEsheetUPLOAD000000000000001");
    expect(extractSpreadsheetId("https://example.com/x")).toBeNull();
  });
});
