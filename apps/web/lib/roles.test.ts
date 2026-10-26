import { describe, expect, it } from "vitest";
import { can, isRole } from "./roles";

describe("role permissions (brief A4a)", () => {
  it("only ADMIN manages users", () => {
    expect(can("ADMIN", "manage_users")).toBe(true);
    expect(can("APPROVER", "manage_users")).toBe(false);
    expect(can("HELPER", "manage_users")).toBe(false);
    expect(can("USER", "manage_users")).toBe(false);
  });

  it("only ADMIN and APPROVER approve rules", () => {
    expect(can("ADMIN", "approve_rules")).toBe(true);
    expect(can("APPROVER", "approve_rules")).toBe(true);
    expect(can("HELPER", "approve_rules")).toBe(false);
    expect(can("USER", "approve_rules")).toBe(false);
  });

  it("USER cannot see staff contacts or cleaned data", () => {
    expect(can("USER", "see_staff_contacts")).toBe(false);
    expect(can("USER", "see_cleaned_data")).toBe(false);
    expect(can("HELPER", "see_cleaned_data")).toBe(false);
  });

  it("everyone with a role can propose and view rules", () => {
    for (const r of ["ADMIN", "APPROVER", "HELPER", "USER"] as const) {
      expect(can(r, "propose_rules")).toBe(true);
      expect(can(r, "view_rule_library")).toBe(true);
    }
  });

  it("no role means no permission", () => {
    expect(can(null, "view_rule_library")).toBe(false);
    expect(can(undefined, "propose_rules")).toBe(false);
    expect(isRole("SUPERUSER")).toBe(false);
    expect(isRole("HELPER")).toBe(true);
  });
});
