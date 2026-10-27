import { describe, expect, it } from "vitest";
import { CANONICAL_FIELDS, IGNORE_FIELD, isMappingChoice, mapHeaders, readChoice } from "../src/index.ts";

// Stage 3 follow-up (decisions 27-Oct-2026): five fields added, Ignore choice. Header texts only.
describe("field list", () => {
  it("has the five new fields once each, keeps followup_log, and Ignore is not a field", () => {
    for (const f of ["phone_number", "policy_holder_name", "room_category", "followup_date", "preauth_approved_amount", "followup_log"]) {
      expect(CANONICAL_FIELDS).toContain(f);
    }
    expect(new Set(CANONICAL_FIELDS).size).toBe(CANONICAL_FIELDS.length);
    expect(CANONICAL_FIELDS).toHaveLength(35);
    expect(CANONICAL_FIELDS as readonly string[]).not.toContain(IGNORE_FIELD);
  });

  it("accepts a field, Ignore or null as a choice; refuses anything else", () => {
    expect(isMappingChoice("phone_number")).toBe(true);
    expect(isMappingChoice(IGNORE_FIELD)).toBe(true);
    expect(isMappingChoice(null)).toBe(true);
    expect(isMappingChoice("")).toBe(false);
    expect(isMappingChoice("ignore")).toBe(false);
    expect(isMappingChoice("not_a_field")).toBe(false);
  });

  it("reads a stored choice: Ignore is ignored, unknown text is extra_fields", () => {
    expect(readChoice(IGNORE_FIELD)).toEqual({ field: null, ignored: true });
    expect(readChoice("room_category")).toEqual({ field: "room_category", ignored: false });
    expect(readChoice(null)).toEqual({ field: null, ignored: false });
    expect(readChoice("old_field_name")).toEqual({ field: null, ignored: false });
  });
});

describe("aliases for the new fields", () => {
  const field = (h: string) => mapHeaders([h])[0]!.field;
  it.each([
    ["Phone", "phone_number"], ["PHONE NO", "phone_number"], ["Mobile", "phone_number"], ["Contact No.", "phone_number"],
    ["Policy Holder", "policy_holder_name"], ["POLICY HOLDER NAME", "policy_holder_name"], ["Insured Name", "policy_holder_name"], ["Card Holder", "policy_holder_name"],
    ["Room Category", "room_category"], ["ROOM TYPE", "room_category"],
    ["Follow Up Date", "followup_date"], ["Next Follow Up", "followup_date"],
    ["Pre-auth Approval Amount", "preauth_approved_amount"], ["PREAUTH APPROVED AMOUNT", "preauth_approved_amount"],
  ])("%s -> %s", (h, f) => expect(field(h)).toBe(f));

  it("existing aliases are unchanged next to the new ones", () => {
    expect(mapHeaders(["Room No", "Follow Up", "Follow Up Remarks", "Claimed Amount"]).map((m) => m.field)).toEqual(["room_no", "followup_log", null, "claimed_amount"]);
  });

  it("never maps a header on the never-on-name-alone list", () => {
    for (const h of ["Amount", "Date", "Status", "Ref No", "Balance", "Deduction", "Approved", "Ref"]) expect(field(h)).toBeNull();
  });
});
