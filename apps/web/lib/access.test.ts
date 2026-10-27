import { describe, expect, it } from "vitest";
import {
  can,
  hasTick,
  isNavItemVisible,
  ALL_ACCESS_TICKS,
  DEFAULT_ACCESS_TICKS,
  type Role,
} from "./roles";

describe("access tests (Stage 2 Task B)", () => {
  // Mocked users representing each of the 6 cases
  const ownerUser = {
    userId: "usr-owner-1",
    email: "anoop@oksy.in",
    role: "OWNER" as Role,
    active: true,
    ticks: ALL_ACCESS_TICKS,
  };

  const adminUser = {
    userId: "usr-admin-1",
    email: "admin@oksy.in",
    role: "ADMIN" as Role,
    active: true,
    ticks: ALL_ACCESS_TICKS,
  };

  const targetAdminUser = {
    userId: "usr-admin-2",
    email: "secondadmin@oksy.in",
    role: "ADMIN" as Role,
    active: true,
    ticks: ALL_ACCESS_TICKS,
  };

  const approvedUserWithViewOnly = {
    userId: "usr-view-1",
    email: "user_view@oksy.in",
    role: "USER" as Role,
    active: true,
    ticks: {
      ...DEFAULT_ACCESS_TICKS,
      hospitals_view: true,
      rule_library_view: true,
    },
  };

  const approvedUserWithNoTicks = {
    userId: "usr-noticks-1",
    email: "user_none@oksy.in",
    role: "USER" as Role,
    active: true,
    ticks: DEFAULT_ACCESS_TICKS,
  };

  const signedInUnapprovedUser = {
    userId: "usr-pending-1",
    email: "new_signin@oksy.in",
    role: null,
    active: false,
    ticks: DEFAULT_ACCESS_TICKS,
  };

  // Helper evaluating whether an actor can change a target's admin access
  function canChangeAdminAccess(actorRole: Role | null, targetRole: Role | string | null): boolean {
    if (targetRole === "ADMIN" && actorRole !== "OWNER") {
      return false;
    }
    return can(actorRole, "manage_users");
  }

  // Helper evaluating Run now access (requirements v2 section 3)
  function canPressRunNow(user: { role: Role | null; active: boolean }): boolean {
    return user.active && user.role !== null;
  }

  // Case 1: Owner: sees and edits everything
  it("Case 1: Owner sees and edits everything", () => {
    // Hospitals
    expect(hasTick(ownerUser.ticks, "hospitals_view", ownerUser.role)).toBe(true);
    expect(hasTick(ownerUser.ticks, "hospitals_add_edit", ownerUser.role)).toBe(true);
    expect(can(ownerUser.role, "helper_work")).toBe(true);
    expect(isNavItemVisible({ tick: "hospitals_view" }, ownerUser.role, ownerUser.ticks)).toBe(true);

    // Rule Library
    expect(hasTick(ownerUser.ticks, "rule_library_view", ownerUser.role)).toBe(true);
    expect(hasTick(ownerUser.ticks, "rule_library_add_edit", ownerUser.role)).toBe(true);
    expect(can(ownerUser.role, "view_rule_library")).toBe(true);
    expect(can(ownerUser.role, "approve_rules")).toBe(true);
    expect(isNavItemVisible({ tick: "rule_library_view" }, ownerUser.role, ownerUser.ticks)).toBe(true);

    // Admin access management
    expect(canChangeAdminAccess(ownerUser.role, targetAdminUser.role)).toBe(true);
    expect(can(ownerUser.role, "manage_users")).toBe(true);

    // Run now
    expect(canPressRunNow(ownerUser)).toBe(true);
  });

  // Case 2: Admin: sees and edits everything; cannot change another Admin's access
  it("Case 2: Admin sees and edits everything; cannot change another Admin's access", () => {
    // Hospitals
    expect(hasTick(adminUser.ticks, "hospitals_view", adminUser.role)).toBe(true);
    expect(hasTick(adminUser.ticks, "hospitals_add_edit", adminUser.role)).toBe(true);
    expect(can(adminUser.role, "helper_work")).toBe(true);
    expect(isNavItemVisible({ tick: "hospitals_view" }, adminUser.role, adminUser.ticks)).toBe(true);

    // Rule Library
    expect(hasTick(adminUser.ticks, "rule_library_view", adminUser.role)).toBe(true);
    expect(hasTick(adminUser.ticks, "rule_library_add_edit", adminUser.role)).toBe(true);
    expect(can(adminUser.role, "view_rule_library")).toBe(true);
    expect(can(adminUser.role, "approve_rules")).toBe(true);
    expect(isNavItemVisible({ tick: "rule_library_view" }, adminUser.role, adminUser.ticks)).toBe(true);

    // Can manage regular users
    expect(can(adminUser.role, "manage_users")).toBe(true);
    expect(canChangeAdminAccess(adminUser.role, "USER")).toBe(true);

    // CANNOT change another Admin's access
    expect(canChangeAdminAccess(adminUser.role, targetAdminUser.role)).toBe(false);

    // Run now
    expect(canPressRunNow(adminUser)).toBe(true);
  });

  // Case 3: Approved User with the view tick only: sees the page; cannot add or edit
  it("Case 3: Approved User with the view tick only: sees the page; cannot add or edit", () => {
    // Sees Hospitals in sidebar and has view tick
    expect(hasTick(approvedUserWithViewOnly.ticks, "hospitals_view", approvedUserWithViewOnly.role)).toBe(true);
    expect(isNavItemVisible({ tick: "hospitals_view" }, approvedUserWithViewOnly.role, approvedUserWithViewOnly.ticks)).toBe(true);

    // Cannot add or edit Hospitals
    expect(hasTick(approvedUserWithViewOnly.ticks, "hospitals_add_edit", approvedUserWithViewOnly.role)).toBe(false);
    expect(can(approvedUserWithViewOnly.role, "helper_work")).toBe(false);

    // Sees Rule Library in sidebar and has view tick / permission
    expect(hasTick(approvedUserWithViewOnly.ticks, "rule_library_view", approvedUserWithViewOnly.role)).toBe(true);
    expect(can(approvedUserWithViewOnly.role, "view_rule_library")).toBe(true);
    expect(isNavItemVisible({ tick: "rule_library_view" }, approvedUserWithViewOnly.role, approvedUserWithViewOnly.ticks)).toBe(true);

    // Cannot add or edit Rule Library
    expect(hasTick(approvedUserWithViewOnly.ticks, "rule_library_add_edit", approvedUserWithViewOnly.role)).toBe(false);
    expect(can(approvedUserWithViewOnly.role, "approve_rules")).toBe(false);

    // Run now is permitted for any approved user
    expect(canPressRunNow(approvedUserWithViewOnly)).toBe(true);
  });

  // Case 4: Approved User with no ticks: sees nothing on protected pages
  it("Case 4: Approved User with no ticks: sees nothing on protected pages", () => {
    // All protected ticks are false
    expect(hasTick(approvedUserWithNoTicks.ticks, "hospitals_view", approvedUserWithNoTicks.role)).toBe(false);
    expect(hasTick(approvedUserWithNoTicks.ticks, "hospitals_add_edit", approvedUserWithNoTicks.role)).toBe(false);
    expect(hasTick(approvedUserWithNoTicks.ticks, "rule_library_view", approvedUserWithNoTicks.role)).toBe(false);
    expect(hasTick(approvedUserWithNoTicks.ticks, "rule_library_add_edit", approvedUserWithNoTicks.role)).toBe(false);
    expect(hasTick(approvedUserWithNoTicks.ticks, "clean_data_view", approvedUserWithNoTicks.role)).toBe(false);
    expect(hasTick(approvedUserWithNoTicks.ticks, "clean_data_download", approvedUserWithNoTicks.role)).toBe(false);
    expect(hasTick(approvedUserWithNoTicks.ticks, "questions_view", approvedUserWithNoTicks.role)).toBe(false);
    expect(hasTick(approvedUserWithNoTicks.ticks, "dashboard_view", approvedUserWithNoTicks.role)).toBe(false);
    expect(hasTick(approvedUserWithNoTicks.ticks, "audit_runs_view", approvedUserWithNoTicks.role)).toBe(false);

    // Navigation items hidden
    expect(isNavItemVisible({ tick: "hospitals_view" }, approvedUserWithNoTicks.role, approvedUserWithNoTicks.ticks)).toBe(false);
    expect(isNavItemVisible({ tick: "rule_library_view" }, approvedUserWithNoTicks.role, approvedUserWithNoTicks.ticks)).toBe(false);
    expect(isNavItemVisible({ tick: "clean_data_view" }, approvedUserWithNoTicks.role, approvedUserWithNoTicks.ticks)).toBe(false);
    expect(isNavItemVisible({ tick: "questions_view" }, approvedUserWithNoTicks.role, approvedUserWithNoTicks.ticks)).toBe(false);
    expect(isNavItemVisible({ requireAdminOrOwner: true }, approvedUserWithNoTicks.role, approvedUserWithNoTicks.ticks)).toBe(false);
  });

  // Case 5: Signed-in but not approved: sees nothing
  it("Case 5: Signed-in but not approved: sees nothing", () => {
    // Role is null, not active
    expect(signedInUnapprovedUser.role).toBeNull();
    expect(signedInUnapprovedUser.active).toBe(false);

    // Cannot view any nav item
    expect(isNavItemVisible({ tick: "hospitals_view" }, signedInUnapprovedUser.role, signedInUnapprovedUser.ticks)).toBe(false);
    expect(isNavItemVisible({ tick: "rule_library_view" }, signedInUnapprovedUser.role, signedInUnapprovedUser.ticks)).toBe(false);
    expect(isNavItemVisible({ tick: "dashboard_view" }, signedInUnapprovedUser.role, signedInUnapprovedUser.ticks)).toBe(false);
    expect(isNavItemVisible({ requireAdminOrOwner: true }, signedInUnapprovedUser.role, signedInUnapprovedUser.ticks)).toBe(false);

    // No ticks pass
    expect(hasTick(signedInUnapprovedUser.ticks, "hospitals_view", signedInUnapprovedUser.role)).toBe(false);
    expect(hasTick(signedInUnapprovedUser.ticks, "rule_library_view", signedInUnapprovedUser.role)).toBe(false);

    // No permissions pass
    expect(can(signedInUnapprovedUser.role, "helper_work")).toBe(false);
    expect(can(signedInUnapprovedUser.role, "approve_rules")).toBe(false);
    expect(can(signedInUnapprovedUser.role, "view_rule_library")).toBe(false);
    expect(can(signedInUnapprovedUser.role, "manage_users")).toBe(false);

    // Cannot press Run now
    expect(canPressRunNow(signedInUnapprovedUser)).toBe(false);
  });

  // Case 6: Run now: any approved user can press it regardless of ticks; a not-approved user cannot
  it("Case 6: Run now: any approved user can press it regardless of ticks; a not-approved user cannot", () => {
    // Approved users can press it
    expect(canPressRunNow(ownerUser)).toBe(true);
    expect(canPressRunNow(adminUser)).toBe(true);
    expect(canPressRunNow(approvedUserWithViewOnly)).toBe(true);
    expect(canPressRunNow(approvedUserWithNoTicks)).toBe(true);

    // Not-approved users cannot press it
    expect(canPressRunNow(signedInUnapprovedUser)).toBe(false);
    expect(canPressRunNow({ role: "USER", active: false })).toBe(false);
    expect(canPressRunNow({ role: null, active: false })).toBe(false);
  });
});
