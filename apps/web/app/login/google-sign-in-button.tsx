"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

export function GoogleSignInButton() {
  const [busy, setBusy] = useState(false);
  async function signIn() {
    setBusy(true);
    const supabase = createClient();
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    });
  }
  return (
    <button type="button" onClick={signIn} disabled={busy}>
      {busy ? "Opening Google…" : "Sign in with Google"}
    </button>
  );
}
