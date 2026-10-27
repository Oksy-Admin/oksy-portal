import { describe, expect, it } from "vitest";
import {
  aliasIndex,
  cleanAliases,
  coreFieldDefs,
  deleteBlockReason,
  isMappingChoice,
  mapHeaders,
  mappedKey,
  normaliseHeader,
  reportFields,
  reportRow,
  type FieldDef,
} from "../src/index.ts";

// Fields page (decisions 27-Oct-2026, handoff 9e). Header texts and invented values only.
// The migration seed check is in packages/worker/test/field-seed.test.ts.
const custom = (over: Partial<FieldDef> = {}): FieldDef => ({
  key: "balance_status", label: "Balance Status", data_type: "text", aliases: ["Balance Status", "Bal Status"], status: "ACTIVE", is_core: false, sort_order: 360, ...over,
});

describe("core list", () => {
  it("no header is an alias of two core fields, so the seeded list maps exactly as before", () => {
    const owner = new Map<string, string>();
    for (const f of coreFieldDefs()) for (const a of f.aliases) {
      const k = normaliseHeader(a);
      expect(owner.get(k) ?? f.key, `${a}`).toBe(f.key);
      owner.set(k, f.key);
    }
    const headers = coreFieldDefs().flatMap((f) => f.aliases).concat(["Amount", "LOS", ""]);
    expect(mapHeaders(headers, {}, coreFieldDefs())).toEqual(mapHeaders(headers));
  });
});

describe("field list from the database", () => {
  const list = [...coreFieldDefs(), custom()];

  it("rename keeps mappings: a new label, same key, same mapping", () => {
    const renamed = list.map((f) => (f.key === "balance_status" ? { ...f, label: "Balance State" } : f));
    const before = mapHeaders(["Sl No", "BAL STATUS"], {}, list);
    const after = mapHeaders(["Sl No", "BAL STATUS"], {}, renamed);
    expect(after).toEqual(before);
    expect(mappedKey(after[1]!)).toBe("balance_status");
  });

  it("a field added on the Fields page maps by its aliases as a custom field", () => {
    const [m] = mapHeaders(["Balance Status"], {}, list);
    expect(m).toMatchObject({ field: null, custom: "balance_status", method: "ALIAS" });
  });

  it("a hidden field is not offered: not proposed by alias, not a valid new choice", () => {
    const hidden = list.map((f) => (f.key === "balance_status" || f.key === "room_no" ? { ...f, status: "HIDDEN" as const } : f));
    expect(mapHeaders(["Balance Status", "Room No"], {}, hidden).map(mappedKey)).toEqual([null, null]);
    expect(isMappingChoice("balance_status", hidden)).toBe(false);
    expect(isMappingChoice("balance_status", list)).toBe(true);
    expect(reportFields(hidden).map((f) => f.key)).not.toContain("balance_status");
  });

  it("an alias claimed by two fields maps to neither (never guess)", () => {
    const clash = [...list, custom({ key: "other", label: "Other", aliases: ["Bal Status"], sort_order: 370 })];
    expect(aliasIndex(clash)[normaliseHeader("Bal Status")]).toBeUndefined();
  });

  it("delete is blocked when a column uses the field, and always for a core field", () => {
    expect(deleteBlockReason(custom(), 1)).toBe("In use, hide instead");
    expect(deleteBlockReason(custom(), 0)).toBeNull();
    expect(deleteBlockReason(coreFieldDefs()[0]!, 0)).toBe("Core field: hide instead");
  });

  it("aliases are cleaned; a too-general header is refused", () => {
    expect(cleanAliases([" Bal Status ", "bal status", "", "Balance  Status"])).toEqual({ aliases: ["Bal Status", "Balance  Status"] });
    expect(cleanAliases(["Balance"])).toHaveProperty("error");
  });
});

describe("report columns", () => {
  it("every ACTIVE field in the fixed order, blank where the hospital has no column", () => {
    const list = [custom(), ...coreFieldDefs()];
    const cols = reportFields(list);
    expect(cols).toHaveLength(36);
    expect(cols[0]!.key).toBe("serial_no");
    expect(cols.at(-1)!.key).toBe("balance_status");
    const row = reportRow(list, { serial_no: "1", patient_name: "Fake Patient" }, { balance_status: "Pending" });
    expect(row).toHaveLength(36);
    expect(row[0]).toBe("1");
    expect(row.at(-1)).toBe("Pending");
    expect(row[2]).toBe(""); // no IP column: blank
  });
});
