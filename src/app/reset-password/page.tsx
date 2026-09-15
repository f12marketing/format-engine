"use client";

import { useState } from "react";
import Link from "next/link";
import { getSupabaseClient, supabaseConfigured } from "@/lib/supabaseClient";

/**
 * Where a password-recovery email link ends up, via /auth/callback -- that
 * route already exchanged the link's code for a session by the time this
 * page renders, so `updateUser` here just needs *a* session, not anything
 * recovery-specific. Which also makes this a normal "change my password"
 * page for anyone who's already signed in and lands here directly.
 */
export default function ResetPasswordPage() {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [state, setState] = useState<"idle" | "submitting" | "error" | "done">("idle");
  const [error, setError] = useState<string | null>(null);

  if (!supabaseConfigured) {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-sm flex-col justify-center px-6">
        <p className="rounded-lg border border-dashed border-line bg-surface-sub p-4 text-sm text-muted">
          Supabase isn&rsquo;t configured yet.
        </p>
      </main>
    );
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (password !== confirm) {
      setState("error");
      setError("Passwords don't match.");
      return;
    }

    const supabase = getSupabaseClient();
    if (!supabase) return;

    setState("submitting");
    setError(null);
    const { error } = await supabase.auth.updateUser({ password });
    if (error) {
      setState("error");
      setError(error.message);
      return;
    }
    setState("done");
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-sm flex-col justify-center px-6">
      <h1 className="text-xl font-semibold tracking-tight">Format Engine</h1>
      <p className="mt-1 text-sm text-muted">Set a new password.</p>

      {state === "done" ? (
        <div className="mt-6 rounded-lg border border-line bg-surface-sub p-4 text-sm">
          <p>Password updated.</p>
          <Link href="/" className="mt-2 inline-block text-accent hover:opacity-80">
            Continue →
          </Link>
        </div>
      ) : (
        <form onSubmit={submit} className="mt-6 space-y-3">
          <input
            type="password"
            required
            autoFocus
            minLength={6}
            autoComplete="new-password"
            placeholder="New password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-lg border border-line bg-surface-sub px-3 py-2.5 text-sm outline-none focus:border-accent"
          />
          <input
            type="password"
            required
            minLength={6}
            autoComplete="new-password"
            placeholder="Confirm new password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            className="w-full rounded-lg border border-line bg-surface-sub px-3 py-2.5 text-sm outline-none focus:border-accent"
          />
          <button
            type="submit"
            disabled={state === "submitting"}
            className="w-full rounded-lg bg-accent px-4 py-2.5 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-60"
          >
            {state === "submitting" ? "Updating…" : "Update password"}
          </button>
          {error && <p className="text-sm text-accent">{error}</p>}
        </form>
      )}
    </main>
  );
}
