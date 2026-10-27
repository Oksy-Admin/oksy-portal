import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { cache } from "react";
import { timed } from "../timing";
import { isRole, type Role, type AccessTicks, ALL_ACCESS_TICKS, DEFAULT_ACCESS_TICKS } from "../roles";
import { supabaseEnv } from "./env";

// A new client per request (never shared). Acts as the logged-in user, so RLS applies.
export async function createClient() {
  const cookieStore = await cookies();
  const { url, key } = supabaseEnv();
  return createServerClient(url, key, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) cookieStore.set(name, value, options);
        } catch {
          // Called from a Server Component, where cookies are read-only; proxy.ts refreshes them.
        }
      },
    },
  });
}

export type Me = {
  userId: string;
  email: string;
  role: Role | null;
  displayName: string | null;
  active: boolean;
  isPending: boolean;
  ticks: AccessTicks;
};

// The logged-in person, their role, approval status and access ticks.
// cache(): the layout and the page share one lookup per request.
export const getMe = cache((): Promise<Me | null> => timed("getMe", loadMe));

async function loadMe(): Promise<Me | null> {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return null;

  const email = (auth.user.email ?? "").toLowerCase();

  const { data: userRole } = await supabase
    .from("users_roles")
    .select("email, role, display_name, active, granted_by, retired_at")
    .eq("user_id", auth.user.id)
    .maybeSingle();

  // If not found by user_id, try by email as well (first sign in)
  const row =
    userRole ??
    (
      await supabase
        .from("users_roles")
        .select("email, role, display_name, active, granted_by, retired_at")
        .eq("email", email)
        .maybeSingle()
    ).data;

  const active = Boolean(row?.active);
  const isPending = Boolean(row && !row.active && !row.retired_at && !row.granted_by);
  const role: Role | null = active && isRole(row?.role) ? row.role : null;
  const displayName = row?.display_name ?? (auth.user.user_metadata?.full_name as string) ?? null;

  let ticks: AccessTicks = DEFAULT_ACCESS_TICKS;
  if (role === "OWNER" || role === "ADMIN") {
    ticks = ALL_ACCESS_TICKS;
  } else if (role && active) {
    const { data: tickRow } = await supabase
      .from("user_access_ticks")
      .select("*")
      .eq("email", row?.email ?? email)
      .maybeSingle();
    if (tickRow) {
      ticks = {
        dashboard_view: Boolean(tickRow.dashboard_view),
        dashboard_copy_reminders: Boolean(tickRow.dashboard_copy_reminders),
        hospitals_view: Boolean(tickRow.hospitals_view),
        hospitals_add_edit: Boolean(tickRow.hospitals_add_edit),
        questions_view: Boolean(tickRow.questions_view),
        questions_mark_answered: Boolean(tickRow.questions_mark_answered),
        clean_data_view: Boolean(tickRow.clean_data_view),
        clean_data_download: Boolean(tickRow.clean_data_download),
        rule_library_view: Boolean(tickRow.rule_library_view),
        rule_library_add_edit: Boolean(tickRow.rule_library_add_edit),
        audit_runs_view: Boolean(tickRow.audit_runs_view),
      };
    }
  }

  return {
    userId: auth.user.id,
    email: row?.email ?? email,
    role,
    displayName,
    active,
    isPending,
    ticks,
  };
}
