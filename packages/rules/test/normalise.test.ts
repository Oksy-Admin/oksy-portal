import { describe, expect, it } from "vitest";
import { detectDateOrder, parseAmountCell, parseDate, parseIdentifier, normaliseName, serialToIso, splitUtrs } from "../src/index.ts";

// File 02 section 3. Fake values only.
const TODAY = "2026-10-26";
const t = (text: string | null, number?: number) => ({ text, number });

describe("amounts", () => {
  it("strips rupee signs, Rs, /- and lakh commas; keeps decimals exactly", () => {
    expect(parseAmountCell(t("₹1,20,000/-")).value).toBe("120000");
    expect(parseAmountCell(t("Rs. 85,500.50")).value).toBe("85500.50");
    expect(parseAmountCell(t("INR 5000")).value).toBe("5000");
  });
  it("uses the cell number when there is one (no rounding by the display format)", () => {
    expect(parseAmountCell(t("85,500", 85499.6)).value).toBe("85499.6");
  });
  it("blank is unknown (never zero); NIL, NA, - are not values", () => {
    expect(parseAmountCell(t(""))).toEqual({ value: null, reason: "INPUT_MISSING" });
    expect(parseAmountCell(t("NIL")).reason).toBe("NOT_A_VALUE");
    expect(parseAmountCell(t("-")).reason).toBe("NOT_A_VALUE");
  });
  it("45k, 1.2 L and two amounts in one cell need a person", () => {
    for (const x of ["45k", "1.2 L", "50000 + 12000"]) {
      expect(parseAmountCell(t(x))).toMatchObject({ value: null, reason: "INPUT_INVALID", needsInput: true });
    }
  });
  it("0 stays 0", () => {
    expect(parseAmountCell(t("0", 0)).value).toBe("0");
  });
});

describe("dates", () => {
  it("reads day-first text formats", () => {
    expect(parseDate(t("12/03/2022"), TODAY).value).toBe("2022-03-12");
    expect(parseDate(t("12-3-22"), TODAY).value).toBe("2022-03-12");
    expect(parseDate(t("12.03.2022"), TODAY).value).toBe("2022-03-12");
    expect(parseDate(t("12 Mar 2022"), TODAY).value).toBe("2022-03-12");
    expect(parseDate(t("12-Sept-2022"), TODAY).value).toBe("2022-09-12");
    expect(parseDate(t("March 12, 2022"), TODAY).value).toBe("2022-03-12");
    expect(parseDate(t("2022-03-12"), TODAY).value).toBe("2022-03-12");
  });
  it("a part above 12 decides the order; both 12 or less is ambiguous", () => {
    expect(parseDate(t("03/25/2022"), TODAY).value).toBe("2022-03-25");
    expect(parseDate(t("05/04/2022"), TODAY)).toMatchObject({ value: "2022-04-05", ambiguous: true });
    expect(parseDate(t("05/04/2022"), TODAY, "MDY").value).toBe("2022-05-04");
  });
  it("real date cells use the serial", () => {
    expect(serialToIso(45000)).toBe("2023-03-15");
    expect(parseDate(t("15-Mar-23 (approx)", 45000), TODAY).value).toBe("2023-03-15");
  });
  it("out of window is kept but marked; words are not dates", () => {
    expect(parseDate(t("01/01/2018"), TODAY)).toMatchObject({ value: "2018-01-01", reason: "OUT_OF_WINDOW" });
    expect(parseDate(t("01/01/2027"), TODAY)).toMatchObject({ value: "2027-01-01", reason: "OUT_OF_WINDOW" });
    expect(parseDate(t("pending"), TODAY)).toMatchObject({ value: null, reason: "NOT_A_VALUE" });
    expect(parseDate(t("31/02/2024"), TODAY)).toMatchObject({ value: null, reason: "INPUT_INVALID" });
  });
  it("sheet order: day-first, month-first or mixed", () => {
    expect(detectDateOrder([[25, 3], [5, 4]])).toBe("DMY");
    expect(detectDateOrder([[3, 25]])).toBe("MDY");
    expect(detectDateOrder([[25, 3], [3, 25]])).toBe("MIXED");
  });
});

describe("identifiers and names", () => {
  it("claim and UTR numbers keep every digit; upper case when asked", () => {
    expect(parseIdentifier(t(" clm-0012 "), { upper: true }).value).toBe("CLM-0012");
    expect(parseIdentifier(t("000123")).value).toBe("000123");
  });
  it("scientific notation: recovered only from a safe whole number, else asked", () => {
    expect(parseIdentifier(t("1.23457E+11", 123456789012)).value).toBe("123456789012");
    expect(parseIdentifier(t("1.23457E+19", 1.23457e19))).toMatchObject({ value: null, reason: "SCI_NOTATION_LOST", needsInput: true });
  });
  it("names: spaces collapsed, serial number dropped, spelling kept", () => {
    expect(normaliseName(t("  12.  FAKE   PATIENT ")).value).toBe("FAKE PATIENT");
  });
  it("UTR cell: a bank reference | UTR pair is one payment; two UTRs are two groups", () => {
    expect(splitUtrs("AXISCN0000FAKE1|UTIBN0000FAKE1")).toEqual([["AXISCN0000FAKE1", "UTIBN0000FAKE1"]]);
    expect(splitUtrs("FAKEUTR0001, FAKEUTR0002")).toEqual([["FAKEUTR0001"], ["FAKEUTR0002"]]);
    expect(splitUtrs("NA")).toEqual([]);
  });
});
