import { isSupabaseConfigured } from "@/lib/supabase/env";
import { GoogleSignInButton } from "./google-sign-in-button";
import { withTiming } from "@/lib/timing";

const MESSAGES: Record<string, string> = {
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
      <p style={{ marginTop: 16, color: "#666", fontSize: "0.9rem" }}>
        Anyone can sign in with their Google account to request access.
        New users see no data until approved by an Admin or the Owner.
      </p>
    </main>
  );
}

export default withTiming("/login", LoginPage);
