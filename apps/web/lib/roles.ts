// What each portal role may do (brief file 12 A4a). Used only to show or hide screens:
// the database (RLS and functions in supabase/migrations) is what actually enforces it.
export const ROLES = ["ADMIN", "APPROVER", "HELPER", "USER"] as const;
export type Role = (typeof ROLES)[number];

export type Permission =
  | "manage_users"
  | "approve_rules" // G9; G10, G12, G13 follow the same roles
  | "helper_work" // G1, G3, G4, G11, tab allow-list, sharing Question Sheets
  | "see_staff_contacts"
  | "see_cleaned_data" // portal table and exports (D-051)
  | "see_audit_log"
  | "propose_rules"
  | "view_rule_library";

const MATRIX: Record<Permission, readonly Role[]> = {
  manage_users: ["ADMIN"],
  approve_rules: ["ADMIN", "APPROVER"],
  helper_work: ["ADMIN", "APPROVER", "HELPER"],
  see_staff_contacts: ["ADMIN", "APPROVER", "HELPER"],
  see_cleaned_data: ["ADMIN", "APPROVER"],
  see_audit_log: ["ADMIN", "APPROVER"],
  propose_rules: ["ADMIN", "APPROVER", "HELPER", "USER"],
  view_rule_library: ["ADMIN", "APPROVER", "HELPER", "USER"],
};

export function can(role: Role | null | undefined, permission: Permission): boolean {
  return role != null && MATRIX[permission].includes(role);
}

export function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value);
}
