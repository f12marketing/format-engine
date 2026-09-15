"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import type { PostgrestError } from "@supabase/supabase-js";
import { getSupabaseClient } from "@/lib/supabaseClient";
import { useSupabaseUser } from "@/hooks/useSupabaseUser";
import type { ProjectDetail } from "@/lib/projects";

/**
 * Read-only: this app doesn't run the story/character/shot generation, so
 * there's nothing here to edit yet, just what `../app` has produced so far.
 */
export default function ProjectDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { user, isLoading: userLoading } = useSupabaseUser();
  const [project, setProject] = useState<ProjectDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    const supabase = getSupabaseClient();
    if (!supabase) return;

    let cancelled = false;
    supabase
      .from("projects")
      .select("*")
      // The id alone would be enough to look up a single row -- this .eq is
      // what keeps the query itself scoped, on top of the RLS policy that
      // enforces the same thing server-side.
      .eq("user_id", user.id)
      .eq("id", id)
      .single()
      .then(({ data, error }: { data: ProjectDetail | null; error: PostgrestError | null }) => {
        if (cancelled) return;
        if (error) setError(error.message);
        else setProject(data);
      });
    return () => {
      cancelled = true;
    };
  }, [user, id]);

  return (
    <main className="mx-auto w-full max-w-3xl px-6 py-12">
      <Link href="/projects" className="font-mono text-xs text-muted hover:text-accent">
        ← Projects
      </Link>

      {userLoading ? (
        <div className="mt-6 rounded-xl border border-line p-6 text-sm text-muted">Loading…</div>
      ) : !user ? (
        <div className="mt-6 rounded-xl border border-dashed border-line p-6 text-sm text-muted">
          <p className="font-medium text-foreground">Sign in to see this.</p>
          <p className="mt-1">
            <a href="/sign-in" className="text-accent hover:opacity-80">
              Sign in
            </a>
          </p>
        </div>
      ) : error ? (
        <p className="mt-6 text-sm text-accent">
          {error === "JSON object requested, multiple (or no) rows returned"
            ? "Not found — either it doesn't exist or it isn't yours."
            : error}
        </p>
      ) : !project ? (
        <div className="mt-6 rounded-xl border border-line p-6 text-sm text-muted">Loading…</div>
      ) : (
        <ProjectBody project={project} />
      )}
    </main>
  );
}

function ProjectBody({ project }: { project: ProjectDetail }) {
  return (
    <>
      <h1 className="mt-3 text-xl font-semibold tracking-tight">
        {project.logline || "(no logline)"}
      </h1>
      <div className="mt-2 flex flex-wrap gap-2 font-mono text-xs text-muted">
        <Pill>{project.output_kind}</Pill>
        <Pill>stage: {project.stage}</Pill>
        <Pill>status: {project.status}</Pill>
        {project.output_kind === "video" && <Pill>render: {project.render_status}</Pill>}
      </div>

      {project.error && (
        <p className="mt-4 rounded-lg border border-accent/40 bg-surface-sub p-3 text-sm text-accent">
          {project.error}
        </p>
      )}
      {project.render_error && (
        <p className="mt-4 rounded-lg border border-accent/40 bg-surface-sub p-3 text-sm text-accent">
          {project.render_error}
        </p>
      )}

      {project.story_markdown && <Section title="Story">{project.story_markdown}</Section>}
      {project.characters_json != null && (
        <JsonSection title="Characters" value={project.characters_json} />
      )}
      {project.backgrounds_json != null && (
        <JsonSection title="Backgrounds" value={project.backgrounds_json} />
      )}
      {project.shots_json != null && <JsonSection title="Shots" value={project.shots_json} />}
      {project.carousel_json != null && (
        <JsonSection title="Carousel" value={project.carousel_json} />
      )}

      {project.final_video_path && (
        <Section title="Final video">{project.final_video_path}</Section>
      )}
    </>
  );
}

function Pill({ children }: { children: React.ReactNode }) {
  return <span className="rounded-full border border-line px-2 py-0.5">{children}</span>;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-6">
      <h2 className="font-mono text-[0.65rem] uppercase tracking-[0.12em] text-muted">{title}</h2>
      <p className="mt-2 whitespace-pre-wrap rounded-xl border border-line bg-surface p-4 text-sm">
        {children}
      </p>
    </section>
  );
}

function JsonSection({ title, value }: { title: string; value: unknown }) {
  return (
    <section className="mt-6">
      <h2 className="font-mono text-[0.65rem] uppercase tracking-[0.12em] text-muted">{title}</h2>
      <pre className="mt-2 overflow-x-auto rounded-xl border border-line bg-surface p-4 font-mono text-xs">
        {JSON.stringify(value, null, 2)}
      </pre>
    </section>
  );
}
