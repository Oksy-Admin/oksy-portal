import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { cache } from "react";
import { timed } from "../timing";
import { isRole, type Role } from "../roles";
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

export type Me = { userId: string; email: string; role: Role | null; displayName: string | null };

// The logged-in person and their active role, or null when not logged in.
// role is null for a login whose access was retired.
// cache(): the layout and the page share one lookup per request (S0 performance quick win).
export const getMe = cache((): Promise<Me | null> => timed("getMe", loadMe));

async function loadMe(): Promise<Me | null> {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return null;
  const { data } = await supabase
    .from("users_roles")
    .select("email, role, display_name, active")
    .eq("user_id", auth.user.id)
    .maybeSingle();
  return {
    userId: auth.user.id,
    email: data?.email ?? auth.user.email ?? "",
    role: data?.active && isRole(data.role) ? data.role : null,
    displayName: data?.display_name ?? null,
  };
}
