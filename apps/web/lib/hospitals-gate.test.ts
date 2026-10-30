import { describe, expect, it } from "vitest";
import { canConfirmMappings, canEditHospitals, canViewHospitals, DEFAULT_ACCESS_TICKS, type AccessTicks, type Role } from "./roles";

const user = (role: Role | null, ticks: Partial<AccessTicks> = {}) => ({ role, ticks: { ...DEFAULT_ACCESS_TICKS, ...ticks } });

describe("/hospitals gate: hospitals_view tick (Item 3)", () => {
  it("a user with hospitals_view sees the page", () => {
    expect(canViewHospitals(user("USER", { hospitals_view: true }))).toBe(true);
  });
  it("a user without hospitals_view does not", () => {
    expect(canViewHospitals(user("USER"))).toBe(false);
    expect(canViewHospitals(user("USER", { rule_library_view: true, hospitals_add_edit: false }))).toBe(false);
  });
  it("Owner and Admin still see it, with or without ticks", () => {
    expect(canViewHospitals(user("OWNER"))).toBe(true);
    expect(canViewHospitals(user("ADMIN"))).toBe(true);
  });
  it("an unapproved sign-in or nobody does not", () => {
    expect(canViewHospitals(user(null, { hospitals_view: true }))).toBe(false);
    expect(canViewHospitals(null)).toBe(false);
  });
  it("view only cannot edit; the edit tick can", () => {
    expect(canEditHospitals(user("USER", { hospitals_view: true }))).toBe(false);
    expect(canEditHospitals(user("USER", { hospitals_view: true, hospitals_add_edit: true }))).toBe(true);
  });
});

describe("confirm column mappings: Owner, Admin or Hospitals edit tick (Item 5)", () => {
  it("Owner and Admin", () => {
    expect(canConfirmMappings(user("OWNER"))).toBe(true);
    expect(canConfirmMappings(user("ADMIN"))).toBe(true);
  });
  it("a user with hospitals_add_edit may confirm; view only may not", () => {
    expect(canConfirmMappings(user("USER", { hospitals_add_edit: true }))).toBe(true);
    expect(canConfirmMappings(user("USER", { hospitals_view: true }))).toBe(false);
    expect(canConfirmMappings(user(null, { hospitals_add_edit: true }))).toBe(false);
  });
});
