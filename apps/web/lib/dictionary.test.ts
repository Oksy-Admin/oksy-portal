import { describe, expect, it } from "vitest";
import { bulkCandidates, crossSuggestionFor, dictionaryItems, type StoredEntry } from "./dictionary";

const entry = (over: Partial<StoredEntry>): StoredEntry => ({
  id: crypto.randomUUID(),
  kind: "STATUS_WORD",
  scheme: "PRIVATE",
  hospital_code: "HOSPPVTP0003",
  spelling_key: "paid",
  spelling_raw: "PAID",
  standard_value: "SETTLED",
  status: "SUGGESTED",
  evidence: null,
  reason: null,
  decided_at: null,
  ...over,
});

describe("dictionaryItems", () => {
  it("hides RETIRED rows (history, not a decision to make)", () => {
    const items = dictionaryItems([entry({ status: "RETIRED" }), entry({ status: "CONFIRMED", spelling_key: "settled" })]);
    expect(items.map((i) => i.entry.spelling_key)).toEqual(["settled"]);
  });

  it("open items come before decided ones", () => {
    const items = dictionaryItems([entry({ status: "CONFIRMED", spelling_key: "settled" }), entry({ status: "SUGGESTED", spelling_key: "paid" })]);
    expect(items.map((i) => i.state)).toEqual(["NEEDS_DECISION", "DECIDED"]);
  });

  it("a rejected spelling is listed as REJECTED, not re-offered as needing a decision", () => {
    const items = dictionaryItems([entry({ status: "REJECTED" })]);
    expect(items[0]!.state).toBe("REJECTED");
  });
});

describe("crossSuggestionFor", () => {
  it("finds another hospital's confirmed value for the same spelling (Policy B + D pre-fill)", () => {
    const all = [entry({ hospital_code: "HOSPPVTP0001", status: "SUGGESTED" }), entry({ hospital_code: "HOSPPVTP0003", status: "CONFIRMED", standard_value: "SETTLED" })];
    const cs = crossSuggestionFor(all[0]!, all);
    expect(cs).toEqual({ standard_value: "SETTLED", from: ["HOSPPVTP0003"] });
  });

  it("a scheme-wide kind (no hospital_code) has no cross-hospital suggestion", () => {
    const e = entry({ kind: "INSURER", hospital_code: null, scheme: "PRIVATE", spelling_key: "star" });
    expect(crossSuggestionFor(e, [e])).toBeNull();
  });

  it("no match when no other hospital confirmed the same spelling", () => {
    const e = entry({ hospital_code: "HOSPPVTP0001" });
    expect(crossSuggestionFor(e, [e])).toBeNull();
  });
});

describe("bulkCandidates", () => {
  it("only undecided, pre-filled, same kind + hospital + scheme items are offered, capped at 50", () => {
    const all = Array.from({ length: 52 }, (_, i) => entry({ hospital_code: "HOSPPVTP0001", spelling_key: `w${i}`, status: "SUGGESTED" }));
    const withSuggestion = all.map((e) => ({ entry: e, state: "NEEDS_DECISION" as const, crossSuggestion: { standard_value: "SETTLED", from: ["HOSPPVTP0003"] } }));
    const { take, rest } = bulkCandidates(withSuggestion, "STATUS_WORD", "HOSPPVTP0001", "PRIVATE");
    expect(take).toHaveLength(50);
    expect(rest).toBe(2);
  });

  it("excludes items with no cross-hospital suggestion", () => {
    const items = [{ entry: entry({}), state: "NEEDS_DECISION" as const, crossSuggestion: null }];
    expect(bulkCandidates(items, "STATUS_WORD", "HOSPPVTP0003", "PRIVATE").take).toEqual([]);
  });
});
