import { IGNORE_FIELD } from "@oksy/rules/fields";
import { describe, expect, it } from "vitest";
import { applyChoice, mappingStatusLabel } from "./mappings";

type Row = { id: string; canonical_field: string | null; status: string; method: string };

/** A fake column_mappings table; save does what approve_column_mapping does (0027/0028). */
function fakeDb(rows: Row[]) {
  const table = new Map(rows.map((r) => [r.id, { ...r }]));
  return {
    save: async (id: string, field: string | null) => {
      const r = table.get(id);
      if (!r) return { ok: false, error: "not found" };
      table.set(id, { ...r, canonical_field: field, status: "APPROVED", method: "MANUAL" });
      return { ok: true };
    },
    /** A page refresh: the rows as the server has them. */
    reload: () => [...table.values()].map((r) => ({ ...r })),
  };
}

describe("Ignore choice is saved on the server (Item 1)", () => {
  it("choose Ignore, reload the data: status = Ignored", async () => {
    const db = fakeDb([{ id: "c1", canonical_field: null, status: "PROPOSED", method: "UNMATCHED" }]);
    const res = await applyChoice("c1", IGNORE_FIELD, db.save);
    expect(res).toEqual({ saved: true, ok: true, error: undefined });
    const [row] = db.reload();
    expect(row?.canonical_field).toBe(IGNORE_FIELD);
    expect(mappingStatusLabel(row!)).toBe("Ignored");
  });

  it("another field is not saved until Approve", async () => {
    const db = fakeDb([{ id: "c1", canonical_field: null, status: "PROPOSED", method: "UNMATCHED" }]);
    const res = await applyChoice("c1", "remarks", db.save);
    expect(res.saved).toBe(false);
    expect(mappingStatusLabel(db.reload()[0]!)).toBe("PROPOSED");
  });

  it("a server refusal is reported, nothing saved", async () => {
    const res = await applyChoice("c1", IGNORE_FIELD, async () => ({ ok: false, error: "Only Owner or Admin" }));
    expect(res).toEqual({ saved: false, ok: false, error: "Only Owner or Admin" });
  });

  it("status labels", () => {
    expect(mappingStatusLabel({ status: "APPROVED", canonical_field: "remarks" })).toBe("APPROVED");
    expect(mappingStatusLabel({ status: "PROPOSED", canonical_field: IGNORE_FIELD })).toBe("PROPOSED");
  });
});
