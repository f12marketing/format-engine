"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { getSupabaseClient, supabaseConfigured } from "@/lib/supabaseClient";

/**
 * Email + password, self-serve.
 *
 * Anyone can create an account here -- there's no invite gate. If the
 * Supabase project has email confirmation turned on, `signUp` won't return a
 * session and the user has to click the confirmation link (which lands on
 * `/auth/callback`) before they can sign in.
 */
export default function SignInPage() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-sm flex-col justify-center px-6">
      <h1 className="text-xl font-semibold tracking-tight">Format Engine</h1>
      <p className="mt-1 text-sm text-muted">Sign in or create an account.</p>

      <Suspense fallback={null}>
        <SignInForm />
      </Suspense>
    </main>
  );
}

type Mode = "sign-in" | "sign-up" | "reset";

function SignInForm() {
  const params = useSearchParams();
  const next = params.get("next") ?? "/";
  const [mode, setModeState] = useState<Mode>("sign-in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [state, setState] = useState<
    "idle" | "submitting" | "error" | "confirm-email" | "reset-sent"
  >("idle");
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

  function setMode(m: Mode) {
    setModeState(m);
    setState("idle");
    setError(null);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const supabase = getSupabaseClient();
    if (!supabase) return;

    setState("submitting");
    setError(null);

    if (mode === "reset") {
      // Lands back on /auth/callback like sign-up confirmation does, just
      // pointed at /reset-password instead of `next` -- that page is where
      // the new password actually gets set, using the session the recovery
      // link's code exchange leaves behind.
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent("/reset-password")}`,
      });
      if (error) {
        setState("error");
        setError(error.message);
        return;
      }
      setState("reset-sent");
      return;
    }

    if (mode === "sign-in") {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) {
        setState("error");
        setError(error.message);
        return;
      }
    } else {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`,
        },
      });
      if (error) {
        setState("error");
        setError(error.message);
        return;
      }
      if (!data.session) {
        // Supabase never errors here even when the email is already taken --
        // it returns an empty `identities` array instead, so probing emails
        // can't be used to enumerate accounts. That's the only way to tell
        // "confirmation email sent" apart from "you already have an account".
        if (data.user && data.user.identities?.length === 0) {
          setState("error");
          setError("An account with this email already exists. Try signing in instead.");
          return;
        }
        setState("confirm-email");
        return;
      }
    }

    // A full navigation, not router.push -- the proxy middleware reads the
    // session from request cookies, and this is the simplest way to make
    // sure the cookies Supabase just wrote are the ones it sees.
    window.location.assign(next);
  }

  if (state === "confirm-email") {
    return (
      <p className="mt-6 rounded-lg border border-line bg-surface-sub p-4 text-sm">
        Check <strong>{email}</strong> for a confirmation link, then sign in.
      </p>
    );
  }

  if (state === "reset-sent") {
    return (
      <p className="mt-6 rounded-lg border border-line bg-surface-sub p-4 text-sm">
        Check <strong>{email}</strong> for a password reset link.
      </p>
    );
  }

  return (
    <form onSubmit={submit} className="mt-6 space-y-3">
      <input
        type="email"
        required
        autoFocus
        autoComplete="email"
        placeholder="you@company.com"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        className="w-full rounded-lg border border-line bg-surface-sub px-3 py-2.5 text-sm outline-none focus:border-accent"
      />
      {mode !== "reset" && (
        <input
          type="password"
          required
          minLength={6}
          autoComplete={mode === "sign-in" ? "current-password" : "new-password"}
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full rounded-lg border border-line bg-surface-sub px-3 py-2.5 text-sm outline-none focus:border-accent"
        />
      )}
      <button
        type="submit"
        disabled={state === "submitting"}
        className="w-full rounded-lg bg-accent px-4 py-2.5 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-60"
      >
        {state === "submitting"
          ? mode === "sign-in"
            ? "Signing in…"
            : mode === "sign-up"
              ? "Creating account…"
              : "Sending…"
          : mode === "sign-in"
            ? "Sign in"
            : mode === "sign-up"
              ? "Create account"
              : "Send reset link"}
      </button>
      {error && <p className="text-sm text-accent">{error}</p>}

      {mode === "sign-in" && (
        <div className="flex items-center justify-between text-sm">
          <button
            type="button"
            onClick={() => setMode("sign-up")}
            className="text-muted hover:text-foreground"
          >
            Need an account? Sign up
          </button>
          <button
            type="button"
            onClick={() => setMode("reset")}
            className="text-muted hover:text-foreground"
          >
            Forgot password?
          </button>
        </div>
      )}
      {mode !== "sign-in" && (
        <button
          type="button"
          onClick={() => setMode("sign-in")}
          className="w-full text-center text-sm text-muted hover:text-foreground"
        >
          {mode === "sign-up" ? "Already have an account? Sign in" : "Back to sign in"}
        </button>
      )}
    </form>
  );
}
