import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Google redirects here after OAuth.
// Under Stage 1 requirements (v2 section 3):
// Anyone can sign in. If they are new, the DB trigger (link_new_auth_user)
// records them as a pending user (active = false). They will see the
// "Waiting for approval" page on the portal until an Admin or Owner approves.
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const providerError = url.searchParams.get("error_description") ?? url.searchParams.get("error");

  if (providerError || !code) {
    return NextResponse.redirect(new URL("/login?error=failed", url.origin));
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    return NextResponse.redirect(new URL("/login?error=failed", url.origin));
  }
  return NextResponse.redirect(new URL("/", url.origin));
}
