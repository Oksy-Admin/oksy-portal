import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Google sends the person back here. An email that no ADMIN registered is refused by
// the database (private.link_new_auth_user), so no login is created for it.
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const providerError = url.searchParams.get("error_description") ?? url.searchParams.get("error");

  if (providerError || !code) {
    const reason = providerError && /database error|not registered/i.test(providerError) ? "not_registered" : "failed";
    return NextResponse.redirect(new URL(`/login?error=${reason}`, url.origin));
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) return NextResponse.redirect(new URL("/login?error=failed", url.origin));
  return NextResponse.redirect(new URL("/", url.origin));
}
