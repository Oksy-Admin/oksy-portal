import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { isSupabaseConfigured, supabaseEnv } from "./lib/supabase/env";
import { timed } from "./lib/timing";

// Keeps the login session fresh and sends anyone not logged in to /login.
// This is only a convenience: every page and the database check access again.
// /dev holds fixture-only previews for Playwright; they exist only under `next dev`.
const PUBLIC_PATHS = ["/login", "/auth/callback", "/api/health", ...(process.env.NODE_ENV === "development" ? ["/dev"] : [])];

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isPublic = PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
  if (!isSupabaseConfigured()) {
    return isPublic ? NextResponse.next() : NextResponse.redirect(new URL("/login", request.url));
  }

  let response = NextResponse.next({ request });
  const { url, key } = supabaseEnv();
  const supabase = createServerClient(url, key, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) response.cookies.set(name, value, options);
      },
    },
  });

  const { data } = await timed("proxy auth", () => supabase.auth.getUser());
  if (!data.user && !isPublic) {
    return NextResponse.redirect(new URL("/login", request.url));
  }
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
