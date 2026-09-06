"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { getSupabaseClient, supabaseConfigured } from "@/lib/supabaseClient";

/**
 * Magic link, not a password.
 *
 * This is invite-only for you and a handful of clients -- no self-serve
 * signup, no password reset flow to build, and one less credential for
 * anyone to reuse from somewhere else. Supabase sends the email with no
 * extra provider configuration.
 */
export default function SignInPage() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-sm flex-col justify-center px-6">
      <h1 className="text-xl font-semibold tracking-tight">Format Engine</h1>
      <p className="mt-1 text-sm text-muted">Invite-only. Sign in with a magic link.</p>

      <Suspense fallback={null}>
        <SignInForm />
      </Suspense>
    </main>
  );
}

function SignInForm() {
  const params = useSearchParams();
  const next = params.get("next") ?? "/";
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  if (!supabaseConfigured) {
    return (
      <p className="mt-6 rounded-lg border border-dashed border-line bg-surface-sub p-4 text-sm text-muted">
        Supabase isn&rsquo;t configured yet — add{" "}
        <code className="font-mono text-xs">NEXT_PUBLIC_SUPABASE_URL</code> and{" "}
        <code className="font-mono text-xs">
          NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
        </code>{" "}
        to <code className="font-mono text-xs">.env.local</code>.
      </p>
    );
  }

  async function sendLink(e: React.FormEvent) {
    e.preventDefault();
    const supabase = getSupabaseClient();
    if (!supabase) return;

    setState("sending");
    setError(null);
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`,
      },
    });
    if (error) {
      setState("error");
      setError(error.message);
    } else {
      setState("sent");
    }
  }

  if (state === "sent") {
    return (
      <p className="mt-6 rounded-lg border border-line bg-surface-sub p-4 text-sm">
        Check <strong>{email}</strong> for a sign-in link.
      </p>
    );
  }

  return (
    <form onSubmit={sendLink} className="mt-6 space-y-3">
      <input
        type="email"
        required
        autoFocus
        placeholder="you@company.com"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        className="w-full rounded-lg border border-line bg-surface-sub px-3 py-2.5 text-sm outline-none focus:border-accent"
      />
      <button
        type="submit"
        disabled={state === "sending"}
        className="w-full rounded-lg bg-accent px-4 py-2.5 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-60"
      >
        {state === "sending" ? "Sending…" : "Send magic link"}
      </button>
      {error && <p className="text-sm text-accent">{error}</p>}
    </form>
  );
}
