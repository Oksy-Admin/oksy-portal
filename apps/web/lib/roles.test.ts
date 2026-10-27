import { describe, expect, it } from "vitest";
import { can, isRole, hasTick, ALL_ACCESS_TICKS, DEFAULT_ACCESS_TICKS } from "./roles";

describe("role permissions (Stage 1)", () => {
  it("OWNER has all permissions", () => {
    expect(can("OWNER", "manage_users")).toBe(true);
    expect(can("OWNER", "approve_rules")).toBe(true);
    expect(can("OWNER", "helper_work")).toBe(true);
    expect(can("OWNER", "see_staff_contacts")).toBe(true);
    expect(can("OWNER", "see_cleaned_data")).toBe(true);
    expect(can("OWNER", "see_audit_log")).toBe(true);
    expect(can("OWNER", "propose_rules")).toBe(true);
    expect(can("OWNER", "view_rule_library")).toBe(true);
  });

  it("ADMIN manages users and has operational permissions", () => {
    expect(can("ADMIN", "manage_users")).toBe(true);
    expect(can("ADMIN", "approve_rules")).toBe(true);
    expect(can("ADMIN", "helper_work")).toBe(true);
    expect(can("ADMIN", "see_staff_contacts")).toBe(true);
    expect(can("ADMIN", "see_cleaned_data")).toBe(true);
    expect(can("ADMIN", "see_audit_log")).toBe(true);
  });

  it("USER cannot manage users, approve rules or see restricted data", () => {
    expect(can("USER", "manage_users")).toBe(false);
    expect(can("USER", "approve_rules")).toBe(false);
    expect(can("USER", "see_staff_contacts")).toBe(false);
    expect(can("USER", "see_cleaned_data")).toBe(false);
    expect(can("USER", "see_audit_log")).toBe(false);
    expect(can("USER", "helper_work")).toBe(false);
    expect(can("USER", "propose_rules")).toBe(true);
    expect(can("USER", "view_rule_library")).toBe(true);
  });

  it("no role means no permission", () => {
    expect(can(null, "view_rule_library")).toBe(false);
    expect(can(undefined, "propose_rules")).toBe(false);
  });

  it("isRole only validates OWNER, ADMIN, USER", () => {
    expect(isRole("OWNER")).toBe(true);
    expect(isRole("ADMIN")).toBe(true);
    expect(isRole("USER")).toBe(true);
    expect(isRole("APPROVER")).toBe(false);
    expect(isRole("HELPER")).toBe(false);
    expect(isRole("SUPERUSER")).toBe(false);
  });

  it("hasTick checks ticks correctly", () => {
    expect(hasTick(ALL_ACCESS_TICKS, "dashboard_view", "USER")).toBe(true);
    expect(hasTick(DEFAULT_ACCESS_TICKS, "dashboard_view", "USER")).toBe(false);
    // OWNER always has tick even if tick object is all false
    expect(hasTick(DEFAULT_ACCESS_TICKS, "dashboard_view", "OWNER")).toBe(true);
    expect(hasTick(null, "dashboard_view", "OWNER")).toBe(true);
    expect(hasTick(null, "dashboard_view", "USER")).toBe(false);
  });
});
