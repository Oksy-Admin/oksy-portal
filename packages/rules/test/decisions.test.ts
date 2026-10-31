import { describe, expect, it } from "vitest";
import {
  autoIgnoreByHeader,
  conflictingHeaders,
  headerKey,
  joinColumnValues,
  looksLikeTdsPercent,
  resolveLayout,
  shapeFits,
  type HeaderDecision,
} from "../src/index.ts";

// Stage 1b-i (decisions.md section 5): one decision per hospital + scheme + header.
// Invented values only.
const layout = (headers: string[]) => ({ map: headers.map((header, column) => ({ column, header })) });
const d = (header: string, canonical_field: string | null, over: Partial<HeaderDecision> = {}): HeaderDecision => ({
  scheme: "PRIVATE",
  header_key: headerKey(header),
  canonical_field,
  decided_by: "fake-user-1",
  ...over,
});

describe("auto-Ignore (decision 30-Oct)", () => {
  it("Length of Stay, Settlement Delay, Balance Amount and TDS % are ignored on the header", () => {
    expect(autoIgnoreByHeader("LOS\n[ LENGTH OF STAY ]")).toBe("Length of Stay");
    expect(autoIgnoreByHeader("LOS")).toBe("Length of Stay");
    expect(autoIgnoreByHeader("SETTLEMENT DELAY\n[ IN DAYS ]")).toBe("Settlement Delay");
    expect(autoIgnoreByHeader("BALANCE AMOUNT")).toBe("Balance Amount");
    expect(autoIgnoreByHeader("TDS %")).toBe("TDS %");
    expect(autoIgnoreByHeader("TDS Percentage")).toBe("TDS %");
  });

  it("Discount, Balance Status, TDS and TDS AMOUNT are not ignored on the header", () => {
    for (const h of ["DISCOUNT", "Balance Status", "TDS", "TDS AMOUNT", "", "Loss"]) expect(autoIgnoreByHeader(h)).toBeNull();
  });

  it("a plain TDS column holding rates is TDS %", () => {
    expect(looksLikeTdsPercent(["10%", "10 %", "", "-"], false)).toBe(true);
    expect(looksLikeTdsPercent(["10", "10", "2"], true)).toBe(true); // next to TDS AMOUNT
    expect(looksLikeTdsPercent(["10", "10"], false)).toBe(false); // alone: could be small amounts, never guess
    expect(looksLikeTdsPercent(["4500", "3000"], true)).toBe(false);
    expect(looksLikeTdsPercent([], true)).toBe(false);
  });
});

describe("value-shape check", () => {
  it("amounts, dates and numbers", () => {
    expect(shapeFits("amount", ["50,000", "₹ 45000.50", "Rs. 300/-", "0", ""])).toBe(true);
    expect(shapeFits("amount", ["01/10/2026", "04/10/2026", "45000"])).toBe(false);
    expect(shapeFits("date", ["01/10/2026", "4-10-26", "12 Oct 2026", "2026-10-12", "Oct 12, 2026"])).toBe(true);
    expect(shapeFits("date", ["45000", "30000"])).toBe(false);
    expect(shapeFits("number", ["1", "2", "3"])).toBe(true);
    expect(shapeFits("text", ["anything", "12"])).toBe(true);
  });

  it("an empty column fits; 80% is enough", () => {
    expect(shapeFits("amount", ["", "-", "NA"])).toBe(true);
    expect(shapeFits("amount", ["100", "200", "300", "400", "pending"])).toBe(true);
    expect(shapeFits("amount", ["100", "200", "300", "pending", "pending"])).toBe(false);
  });
});

describe("resolveLayout", () => {
  const HEAD = ["Sl No", "PATIENT NAME", "BILL AMOUNT", "LOS", "", "REMARK", "FOLLOW UP REMARKS", "UHID"];
  const decisions = [
    d("Sl No", "serial_no"),
    d("PATIENT NAME", "patient_name"),
    d("BILL AMOUNT", "bill_amount"),
    d("REMARK", "remarks"),
    d("FOLLOW UP REMARKS", "remarks"),
    d("UHID", "uhid"),
  ];

  it("every header decided once: the layout is confirmed, auto-Ignore and blank need nothing", () => {
    const r = resolveLayout(layout(HEAD), { scheme: "PRIVATE", decisions });
    expect(r.needs).toEqual([]);
    expect(r.reused).toBe(6);
    expect(r.autoIgnored).toEqual([{ column: 3, header: "LOS", reason: "Length of Stay" }]);
    expect(r.map.map((m) => [m.field ?? m.custom ?? null, !!m.ignored, m.method])).toEqual([
      ["serial_no", false, "MANUAL"],
      ["patient_name", false, "MANUAL"],
      ["bill_amount", false, "MANUAL"],
      [null, true, "MANUAL"],
      [null, false, "UNMATCHED"], // blank header: extra_fields under "Column 5"
      ["remarks", false, "MANUAL"],
      ["remarks", false, "MANUAL"],
      ["uhid", false, "MANUAL"],
    ]);
  });

  it("a header with no decision for this scheme goes to the decision list", () => {
    const r = resolveLayout(layout([...HEAD, "MAIL SUBJECT"]), { scheme: "PRIVATE", decisions });
    expect(r.needs).toEqual([{ column: 8, header: "MAIL SUBJECT", header_key: "mailsubject", reason: "NOT_DECIDED", note: null }]);
    const other = resolveLayout(layout(["Sl No"]), { scheme: "KASP", decisions });
    expect(other.needs.map((n) => n.reason)).toEqual(["NOT_DECIDED"]); // decisions belong to one scheme
  });

  it("Ignore is a decision: the column is not read and nothing waits", () => {
    const r = resolveLayout(layout(["Sl No", "MAIL SUBJECT"]), { scheme: "PRIVATE", decisions: [...decisions, d("MAIL SUBJECT", "IGNORE")] });
    expect(r.needs).toEqual([]);
    expect(r.map[1]).toMatchObject({ ignored: true, method: "MANUAL" });
  });

  it("value-shape check: an amount field holding dates stops reuse", () => {
    const values = (c: number) => (c === 2 ? ["01/10/2026", "02/10/2026"] : []);
    const r = resolveLayout(layout(HEAD), { scheme: "PRIVATE", decisions, values });
    expect(r.needs).toMatchObject([{ column: 2, header_key: "billamount", reason: "SHAPE" }]);
    expect(r.needs[0]!.note).toContain("amounts");
    expect(r.map[2]).toMatchObject({ field: null, method: "UNMATCHED" });
    // A person confirmed it anyway: reuse goes ahead.
    const ok = resolveLayout(layout(HEAD), { scheme: "PRIVATE", decisions: decisions.map((x) => (x.header_key === "billamount" ? { ...x, accept_any_shape: true } : x)), values });
    expect(ok.needs).toEqual([]);
  });

  it("consistency guard: two decisions for one header in the hospital stop reuse", () => {
    const all = [...decisions, d("BILL AMOUNT", "claimed_amount", { scheme: "KASP" })];
    expect(conflictingHeaders(all)).toEqual(new Set(["billamount"]));
    const r = resolveLayout(layout(HEAD), { scheme: "PRIVATE", decisions: all });
    expect(r.needs.map((n) => [n.header_key, n.reason])).toEqual([["billamount", "TWO_FIELDS_IN_HOSPITAL"]]);
  });

  it("TDS next to TDS AMOUNT holding rates is ignored; holding amounts it is a decision to make", () => {
    const tds = [d("TDS", "tds_amount_stated"), d("TDS AMOUNT", "tds_amount_stated")];
    const rates = resolveLayout(layout(["TDS", "TDS AMOUNT"]), { scheme: "PRIVATE", decisions: tds, values: (c) => (c === 0 ? ["10", "10"] : ["4500", "300"]) });
    expect(rates.needs).toEqual([]);
    expect(rates.autoIgnored).toEqual([{ column: 0, header: "TDS", reason: "TDS %" }]);
    expect(rates.map[1]).toMatchObject({ field: "tds_amount_stated" });
    const amounts = resolveLayout(layout(["TDS", "TDS AMOUNT"]), { scheme: "PRIVATE", decisions: tds, values: () => ["4500", "300"] });
    expect(amounts.needs.map((n) => [n.column, n.reason])).toEqual([
      [0, "FIELD_TWICE_IN_TAB"],
      [1, "FIELD_TWICE_IN_TAB"],
    ]);
  });

  it("a repeated header keeps the first column, except remarks", () => {
    const r = resolveLayout(layout(["DISCOUNT", "REMARK", "DISCOUNT", "REMARK"]), { scheme: "PRIVATE", decisions: [d("DISCOUNT", "discount_amount"), d("REMARK", "remarks")] });
    expect(r.needs).toEqual([]);
    expect(r.map.map((m) => [m.field, m.method])).toEqual([
      ["discount_amount", "MANUAL"],
      ["remarks", "MANUAL"],
      [null, "DUPLICATE_HEADER"],
      ["remarks", "MANUAL"],
    ]);
  });
});

describe("remarks joined with the column name (decision 30-Oct)", () => {
  it("prefixes each value by its column name; empties skipped", () => {
    expect(joinColumnValues(["fake note", "", "call back"], ["REMARK", "REMARK", "FOLLOW UP\nREMARKS"])).toBe("REMARK: fake note | FOLLOW UP REMARKS: call back");
    expect(joinColumnValues(["a", " b "])).toBe("a | b");
  });
});

describe("Balance Status is a column of its own (Stage 1c)", () => {
  const decisions: HeaderDecision[] = [{ scheme: "PRIVATE", header_key: "balancestatus", canonical_field: "balance_status" }];
  const layout = { map: [{ column: 0, header: "BALANCE STATUS" }, { column: 1, header: "BALANCE AMOUNT" }] };
  const values = (c: number) => (c === 0 ? ["Pending", "Cleared", "Partly paid"] : ["1200", "0", "350"]);

  it("is never auto-Ignored like Balance Amount", () => {
    expect(autoIgnoreByHeader("BALANCE STATUS")).toBeNull();
    expect(autoIgnoreByHeader("Bal Status")).toBeNull();
    expect(autoIgnoreByHeader("BALANCE AMOUNT")).toBe("Balance Amount");
  });

  it("takes its decided field (a field added on the Fields page); Balance Amount stays ignored", () => {
    const r = resolveLayout(layout, { scheme: "PRIVATE", decisions, values });
    expect(r.needs).toEqual([]);
    expect(r.map[0]).toMatchObject({ column: 0, custom: "balance_status", method: "MANUAL" });
    expect(r.map[1]).toMatchObject({ column: 1, ignored: true });
    expect(r.autoIgnored.map((a) => a.reason)).toEqual(["Balance Amount"]);
  });

  it("without a decision it waits on the decision list (never guessed from Balance Amount)", () => {
    const r = resolveLayout(layout, { scheme: "PRIVATE", decisions: [], values });
    expect(r.needs.map((n) => [n.header, n.reason])).toEqual([["BALANCE STATUS", "NOT_DECIDED"]]);
  });
});
