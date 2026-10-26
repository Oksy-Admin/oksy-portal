import { isSupabaseConfigured } from "@/lib/supabase/env";
import { GoogleSignInButton } from "./google-sign-in-button";
import { withTiming } from "@/lib/timing";

const MESSAGES: Record<string, string> = {
  not_registered:
    "This Google account is not registered for the Oksy portal. Ask Anoop (ADMIN) to add your email.",
  failed: "Sign-in did not complete. Please try again.",
};

async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  return (
    <main className="card" style={{ maxWidth: 440, margin: "12vh auto", padding: 28 }}>
      <h1>Oksy Data Cleanse</h1>
      {error && <p role="alert">{MESSAGES[error] ?? MESSAGES.failed}</p>}
      {isSupabaseConfigured() ? (
        <GoogleSignInButton />
      ) : (
        <p>Login is not set up yet: the Supabase project does not exist.</p>
      )}
      <p>Only people added by an ADMIN can sign in. Hospital staff do not use this portal.</p>
    </main>
  );
}

export default withTiming("/login", LoginPage);
