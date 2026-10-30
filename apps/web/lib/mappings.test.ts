import { IGNORE_FIELD } from "@oksy/rules/fields";
import { describe, expect, it } from "vitest";
import { applyChoice, choiceLabel, headerItems, type StoredColumn, type StoredDecision } from "./mappings";

// Stage 1b-i: the decision list shows each header of a hospital + scheme once. Fake data only.
const col = (tab_name: string, source_header: string, over: Partial<StoredColumn> = {}): StoredColumn => ({
  hospital_code: "HOSPPVTPTEST",
  scheme: "PRIVATE",
  tab_name,
  source_header,
  header_key: null,
  canonical_field: null,
  status: "PROPOSED",
  review_reason: null,
  ...over,
});
const dec = (header_key: string, canonical_field: string | null): StoredDecision => ({
  hospital_code: "HOSPPVTPTEST", scheme: "PRIVATE", header_key, canonical_field, accept_any_shape: false, method: "MANUAL", decided_at: "2026-10-31T05:00:00Z",
});

/** A fake header_decisions table; save does what decide_header does. */
function fakeDb() {
  const rows = new Map<string, StoredDecision>();
  return {
    save: (key: string) => async (field: string | null) => {
      rows.set(key, dec(key, field));
      return { ok: true };
    },
    /** A page refresh: the rows as the server has them. */
    reload: () => [...rows.values()],
  };
}

describe("decision list: one item per hospital + scheme + header", () => {
  const columns = [
    col("OCT 2026", "CLAIM NO", { canonical_field: "preauth_or_claim_no" }),
    col("SEP 2026", "Claim No.", { canonical_field: "preauth_or_claim_no" }),
    col("OCT 2026", "MAIL SUBJECT"),
    col("OCT 2026", "LOS"),
    col("OCT 2026", "Column 27"),
    col("OCT 2026", "BILL AMOUNT", { canonical_field: "bill_amount", review_reason: "The values in this column do not look like amounts." }),
    col("OCT 2026", "CLAIM NO", { scheme: "KASP", canonical_field: "preauth_or_claim_no" }),
  ];

  it("the same header on two tabs is one item; blank headers are not listed; open ones first", () => {
    const items = headerItems(columns, [dec("claimno", "preauth_or_claim_no"), dec("billamount", "bill_amount")]);
    expect(items.map((i) => [i.scheme, i.header, i.state])).toEqual([
      ["KASP", "CLAIM NO", "NEEDS_DECISION"], // decisions belong to one scheme
      ["PRIVATE", "BILL AMOUNT", "CHECK_AGAIN"],
      ["PRIVATE", "MAIL SUBJECT", "NEEDS_DECISION"],
      ["PRIVATE", "CLAIM NO", "DECIDED"],
      ["PRIVATE", "LOS", "AUTO_IGNORED"],
    ]);
    const claim = items.find((i) => i.scheme === "PRIVATE" && i.header_key === "claimno")!;
    expect(claim.tabs).toEqual(["OCT 2026", "SEP 2026"]);
    expect(claim.suggestion).toBe("preauth_or_claim_no");
    expect(items.find((i) => i.header_key === "billamount")!.reasons).toEqual(["The values in this column do not look like amounts."]);
  });

  it("Ignore is saved at once and survives a refresh", async () => {
    const db = fakeDb();
    const res = await applyChoice(IGNORE_FIELD, db.save("mailsubject"));
    expect(res).toEqual({ saved: true, ok: true, error: undefined });
    const after = headerItems(columns, db.reload()).find((i) => i.header_key === "mailsubject")!;
    expect(after.state).toBe("DECIDED");
    expect(after.decision?.canonical_field).toBe(IGNORE_FIELD);
  });

  it("another field waits for Save; a refusal is reported", async () => {
    const db = fakeDb();
    expect((await applyChoice("remarks", db.save("mailsubject"))).saved).toBe(false);
    expect(db.reload()).toEqual([]);
    const res = await applyChoice(IGNORE_FIELD, async () => ({ ok: false, error: "Only Owner or Admin" }));
    expect(res).toEqual({ saved: false, ok: false, error: "Only Owner or Admin" });
  });

  it("choice labels", () => {
    expect(choiceLabel(IGNORE_FIELD, {})).toBe("Ignore (not needed)");
    expect(choiceLabel(null, {})).toBe("Keep in extra columns");
    expect(choiceLabel("remarks", { remarks: "Remarks" })).toBe("Remarks");
  });
});
