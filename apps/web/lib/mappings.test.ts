import { readFileSync } from "node:fs";
import { IGNORE_FIELD } from "@oksy/rules/fields";
import { describe, expect, it } from "vitest";
import { applyChoice, BULK_MAX, bulkCandidates, choiceLabel, crossSuggestionFor, headerItems, type StoredColumn, type StoredDecision } from "./mappings";

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

describe("suggestions from other hospitals of the same scheme (Stage 1b-ii)", () => {
  const other = (hospital_code: string, header_key: string, canonical_field: string | null, scheme = "PRIVATE"): StoredDecision => ({
    ...dec(header_key, canonical_field),
    hospital_code,
    scheme,
  });
  const decisions = [
    other("HOSPPVTPOLD1", "billamount", "bill_amount"),
    other("HOSPPVTPOLD2", "billamount", "bill_amount"),
    other("HOSPPVTPOLD3", "billamount", "claimed_amount"),
    other("HOSPPVTPOLD1", "ward", IGNORE_FIELD),
    other("HOSPPVTPOLD1", "mailsubject", "remarks", "KASP"), // another scheme: not a suggestion
    dec("claimno", "preauth_or_claim_no"), // this hospital's own decision
  ];

  it("the most common decision, with the hospitals that made it; other schemes do not count", () => {
    expect(crossSuggestionFor("HOSPPVTPTEST", "PRIVATE", "billamount", decisions)).toEqual({ field: "bill_amount", from: ["HOSPPVTPOLD1", "HOSPPVTPOLD2"] });
    expect(crossSuggestionFor("HOSPPVTPTEST", "PRIVATE", "mailsubject", decisions)).toBeNull();
    expect(crossSuggestionFor("HOSPPVTPTEST", "PRIVATE", "claimno", decisions)).toBeNull(); // only its own
  });

  it("Confirm all takes undecided headers with an exact suggestion, unless the dropdown was changed", () => {
    const cols = [col("OCT 2026", "BILL AMOUNT"), col("OCT 2026", "Ward"), col("OCT 2026", "MAIL SUBJECT"), col("OCT 2026", "CLAIM NO"), col("OCT 2026", "LOS")];
    const items = headerItems(cols, decisions);
    expect(items.find((i) => i.header_key === "claimno")!.crossSuggestion).toBeNull(); // decided
    expect(bulkCandidates(items).take.map((i) => [i.header, i.crossSuggestion!.field])).toEqual([
      ["BILL AMOUNT", "bill_amount"],
      ["Ward", IGNORE_FIELD],
    ]);
    expect(bulkCandidates(items, { "HOSPPVTPTEST|PRIVATE|ward": "remarks" }).take.map((i) => i.header)).toEqual(["BILL AMOUNT"]);
  });

  it("at most 50 in one action; the rest wait for the next", () => {
    const cols = Array.from({ length: 53 }, (_, n) => col("OCT 2026", `HEADER ${n}`));
    const many = cols.map((c) => other("HOSPPVTPOLD1", c.source_header.toLowerCase().replace(/[^a-z0-9]/g, ""), null));
    const { take, rest } = bulkCandidates(headerItems(cols, many));
    expect(take).toHaveLength(BULK_MAX);
    expect(rest).toBe(3);
  });
});

describe("Confirm all on the pilot fixtures: HMS as if it were a new hospital", () => {
  interface Fx { hospital_code: string; scheme: string; tabs: Array<{ tab: string; columns: Array<{ header: string }> }>; decisions: Array<{ scheme: string; header_key: string; canonical_field: string | null }> }
  const fx = (code: string) => JSON.parse(readFileSync(new URL(`../../../packages/rules/test/fixtures/pilots/${code}.json`, import.meta.url), "utf8")) as Fx;
  const [bad, tree, hms] = [fx("HOSPPVTP0001"), fx("HOSPPVTP0002"), fx("HOSPPVTP0003")];
  const decisionsOf = (f: Fx): StoredDecision[] => f.decisions.map((d) => ({ ...d, hospital_code: f.hospital_code, accept_any_shape: false, method: "MANUAL", decided_at: "2026-10-31T05:00:00Z" }));
  const columns: StoredColumn[] = hms.tabs.flatMap((t) => t.columns.filter((c) => c.header).map((c) => col(t.tab, c.header, { hospital_code: hms.hospital_code, scheme: hms.scheme })));

  it("most headers are pre-filled from Badagara and Tree G; one click confirms them", () => {
    const items = headerItems(columns, [...decisionsOf(bad), ...decisionsOf(tree)]);
    const open = items.filter((i) => i.state === "NEEDS_DECISION");
    const { take, rest } = bulkCandidates(items);
    expect([open.length, take.length, rest]).toEqual([42, 30, 0]);
    expect(take.every((i) => i.crossSuggestion!.from.every((h) => h === bad.hospital_code || h === tree.hospital_code))).toBe(true);
    // What is left for a person: headers no other pilot has.
    expect(open.filter((i) => !i.crossSuggestion).map((i) => i.header).sort()).toEqual([
      "#VALUE!", "CARD NUMBER / POLICY NUMBER", "CLAIM REMARK", "CONTACT NUMBER", "DOCTOR", "HOSPITAL BILL AMOUNT",
      "Insurance Company Name", "MAIL SENT DATE", "MAIL SUBJECT", "ROOM", "STAR HEALTH", "TDS",
    ]);
  });
});
