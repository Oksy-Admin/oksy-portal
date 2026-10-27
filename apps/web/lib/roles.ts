// Roles and access model for Oksy Data Cleanse portal (Stage 1).
// Requirements: requirements_v2.md sections 2.7, 3, and change log in 2.6.
// Roles: OWNER (full access), ADMIN (approves users, sets user access), USER (default).
// APPROVER and HELPER are retained in DB enum for backward compatibility but unused.

export const ROLES = ["OWNER", "ADMIN", "USER"] as const;
export type Role = (typeof ROLES)[number];

export type AccessTicks = {
  dashboard_view: boolean;
  dashboard_copy_reminders: boolean;
  hospitals_view: boolean;
  hospitals_add_edit: boolean;
  questions_view: boolean;
  questions_mark_answered: boolean;
  clean_data_view: boolean;
  clean_data_download: boolean;
  rule_library_view: boolean;
  rule_library_add_edit: boolean;
  audit_runs_view: boolean;
};

export const DEFAULT_ACCESS_TICKS: AccessTicks = {
  dashboard_view: false,
  dashboard_copy_reminders: false,
  hospitals_view: false,
  hospitals_add_edit: false,
  questions_view: false,
  questions_mark_answered: false,
  clean_data_view: false,
  clean_data_download: false,
  rule_library_view: false,
  rule_library_add_edit: false,
  audit_runs_view: false,
};

export const ALL_ACCESS_TICKS: AccessTicks = {
  dashboard_view: true,
  dashboard_copy_reminders: true,
  hospitals_view: true,
  hospitals_add_edit: true,
  questions_view: true,
  questions_mark_answered: true,
  clean_data_view: true,
  clean_data_download: true,
  rule_library_view: true,
  rule_library_add_edit: true,
  audit_runs_view: true,
};

export type Permission =
  | "manage_users"
  | "approve_rules"
  | "helper_work"
  | "see_staff_contacts"
  | "see_cleaned_data"
  | "see_audit_log"
  | "propose_rules"
  | "view_rule_library";

// Backward-compatible permission matrix for existing pages
const MATRIX: Record<Permission, readonly Role[]> = {
  manage_users: ["OWNER", "ADMIN"],
  approve_rules: ["OWNER", "ADMIN"],
  helper_work: ["OWNER", "ADMIN"],
  see_staff_contacts: ["OWNER", "ADMIN"],
  see_cleaned_data: ["OWNER", "ADMIN"],
  see_audit_log: ["OWNER", "ADMIN"],
  propose_rules: ["OWNER", "ADMIN", "USER"],
  view_rule_library: ["OWNER", "ADMIN", "USER"],
};

export function can(role: Role | string | null | undefined, permission: Permission): boolean {
  if (!role) return false;
  if (role === "OWNER") return true;
  // If role is one of our active roles:
  if (isRole(role)) {
    return MATRIX[permission].includes(role);
  }
  // Fallbacks for legacy DB values if present temporarily:
  if (role === "APPROVER") {
    return ["approve_rules", "helper_work", "see_staff_contacts", "see_cleaned_data", "see_audit_log", "propose_rules", "view_rule_library"].includes(permission);
  }
  if (role === "HELPER") {
    return ["helper_work", "see_staff_contacts", "propose_rules", "view_rule_library"].includes(permission);
  }
  return false;
}

export function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value);
}

// Check specific access tick for a user
export function hasTick(ticks: AccessTicks | null | undefined, tick: keyof AccessTicks, role?: Role | string | null): boolean {
  if (role === "OWNER") return true;
  if (!ticks) return false;
  return Boolean(ticks[tick]);
}

// Determines whether a portal navigation item is visible for a given role and ticks
export function isNavItemVisible(
  item: { tick?: keyof AccessTicks; requireAdminOrOwner?: boolean },
  role: Role | null,
  ticks?: AccessTicks
): boolean {
  if (role === null) return false;
  if (role === "OWNER") return true;
  if (item.requireAdminOrOwner) {
    return can(role, "manage_users");
  }
  if (role === "ADMIN") return true;
  if (item.tick) {
    return hasTick(ticks, item.tick, role);
  }
  return true;
}
