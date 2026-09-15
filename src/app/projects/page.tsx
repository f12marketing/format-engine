"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { PostgrestError } from "@supabase/supabase-js";
import { getSupabaseClient, supabaseConfigured } from "@/lib/supabaseClient";
import { useSupabaseUser } from "@/hooks/useSupabaseUser";
import { StatusPill } from "@/components/StatusPill";
import { SUMMARY_COLUMNS, type ProjectOutputKind, type ProjectSummary } from "@/lib/projects";

/**
 * Mirrors `../app`'s dashboard list -- same source table, same summary
 * columns -- but scoped to the signed-in Supabase user instead of that
 * app's single-tenant, no-auth model.
 */
export default function ProjectsPage() {
  return (
    <main className="mx-auto w-full max-w-3xl px-6 py-10">
      <h1 className="text-xl font-semibold tracking-tight">Projects</h1>
      <p className="mt-1 text-sm text-muted">
        The story-to-animation pipeline -- shared with the standalone app, scoped to you.
      </p>

      {!supabaseConfigured ? (
        <p className="mt-6 rounded-lg border border-dashed border-line bg-surface-sub p-4 text-sm text-muted">
          Supabase isn&rsquo;t configured yet.
        </p>
      ) : (
        <ProjectsBody />
      )}
    </main>
  );
}

function ProjectsBody() {
  const { user, isLoading: userLoading } = useSupabaseUser();
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    const supabase = getSupabaseClient();
    if (!supabase) return;

    let cancelled = false;
    supabase
      .from("projects")
      .select(SUMMARY_COLUMNS)
      // RLS (`auth.uid() = user_id`) is what actually enforces this -- this
      // filter just keeps the query itself honest about what it's asking for.
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .then(({ data, error }: { data: ProjectSummary[] | null; error: PostgrestError | null }) => {
        if (cancelled) return;
        if (error) setListError(error.message);
        else setProjects(data);
      });
    return () => {
      cancelled = true;
    };
  }, [user]);

  if (userLoading) {
    return (
      <div className="mt-6 rounded-xl border border-line p-6 text-sm text-muted">Loading…</div>
    );
  }

  if (!user) {
    return (
      <div className="mt-6 rounded-xl border border-dashed border-line p-6 text-sm text-muted">
        <p className="font-medium text-foreground">Sign in to see this.</p>
        <p className="mt-1">
          <a href="/sign-in" className="text-accent hover:opacity-80">
            Sign in
          </a>{" "}
          -- projects are scoped to a signed-in user.
        </p>
      </div>
    );
  }

  return (
    <>
      <NewProjectForm
        userId={user.id}
        onCreated={(project) => setProjects((prev) => (prev ? [project, ...prev] : [project]))}
      />

      <h2 className="mt-10 font-mono text-[0.65rem] uppercase tracking-[0.12em] text-muted">
        Your projects
      </h2>
      {listError && <p className="mt-2 text-sm text-accent">{listError}</p>}
      {!projects ? (
        <div className="mt-2 rounded-xl border border-line p-6 text-sm text-muted">Loading…</div>
      ) : !projects.length ? (
        <div className="mt-2 rounded-xl border border-dashed border-line p-8 text-center text-sm text-muted">
          No projects yet.
        </div>
      ) : (
        <ul className="mt-2 space-y-2">
          {projects.map((project) => (
            <li key={project.id}>
              <Link
                href={`/projects/${project.id}`}
                className="flex items-center gap-3 rounded-xl border border-line bg-surface px-4 py-3 hover:border-accent"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">
                    {project.logline || "(no logline)"}
                  </span>
                  <span className="block font-mono text-xs text-muted">
                    {project.output_kind} · {project.stage} ·{" "}
                    {new Date(project.updated_at).toLocaleString()}
                  </span>
                </span>
                <StatusPill status={project.status} />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function NewProjectForm({
  userId,
  onCreated,
}: {
  userId: string;
  onCreated: (project: ProjectSummary) => void;
}) {
  const [logline, setLogline] = useState("");
  const [outputKind, setOutputKind] = useState<ProjectOutputKind>("video");
  const [targetDurationSeconds, setTargetDurationSeconds] = useState(30);
  const [state, setState] = useState<"idle" | "submitting" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const supabase = getSupabaseClient();
    if (!supabase) return;

    setState("submitting");
    setError(null);

    const { data, error } = await supabase
      .from("projects")
      .insert({
        // The column defaults to auth.uid() already -- set explicitly so the
        // insert is self-contained and doesn't rely on that default existing.
        user_id: userId,
        logline: logline.trim(),
        output_kind: outputKind,
        stage: outputKind === "carousel" ? "carousel" : "story",
        ...(outputKind === "video" ? { target_duration_seconds: targetDurationSeconds } : {}),
      })
      .select(SUMMARY_COLUMNS)
      .single();

    if (error) {
      setState("error");
      setError(error.message);
      return;
    }

    setState("idle");
    setLogline("");
    onCreated(data as ProjectSummary);
  }

  return (
    <form onSubmit={submit} className="rounded-xl border border-line bg-surface p-4">
      <label className="block font-mono text-[0.65rem] uppercase tracking-[0.12em] text-muted">
        New project
      </label>
      <textarea
        required
        placeholder="Logline — what's this one about?"
        value={logline}
        onChange={(e) => setLogline(e.target.value)}
        rows={2}
        className="mt-2 w-full resize-none rounded-lg border border-line bg-surface-sub px-3 py-2.5 text-sm outline-none focus:border-accent"
      />
      <div className="mt-3 flex flex-wrap items-center gap-4">
        <div className="flex gap-3 text-sm">
          {(["video", "carousel"] as const).map((kind) => (
            <label key={kind} className="flex items-center gap-1.5">
              <input
                type="radio"
                name="output_kind"
                checked={outputKind === kind}
                onChange={() => setOutputKind(kind)}
              />
              {kind === "video" ? "Video" : "Carousel"}
            </label>
          ))}
        </div>
        {outputKind === "video" && (
          <label className="flex items-center gap-1.5 text-sm text-muted">
            Duration
            <input
              type="number"
              min={5}
              max={300}
              value={targetDurationSeconds}
              onChange={(e) => setTargetDurationSeconds(Number(e.target.value))}
              className="w-16 rounded-md border border-line bg-surface-sub px-2 py-1 text-sm outline-none focus:border-accent"
            />
            s
          </label>
        )}
        <button
          type="submit"
          disabled={state === "submitting"}
          className="ml-auto rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-60"
        >
          {state === "submitting" ? "Creating…" : "Create project"}
        </button>
      </div>
      {error && <p className="mt-2 text-sm text-accent">{error}</p>}
    </form>
  );
}

