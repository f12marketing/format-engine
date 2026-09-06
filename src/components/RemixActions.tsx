"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";

/**
 * The two remix actions, offered on every finished job -- see `convex/remix.ts`
 * for the split this mirrors: P1 is copy, P7/P8 always re-run, everything else
 * is "visual". Kept in sync with that file rather than imported from it,
 * since a plain helper in a convex/*.ts file can't be imported into the
 * client bundle the way a query or mutation can.
 */
const COPY_PRIMITIVES = new Set(["P1"]);
const ALWAYS_RERUN_PRIMITIVES = new Set(["P7", "P8"]);
const GATED_FORMATS = new Set(["video-animation", "product-spokesperson"]);

function isMeaningful(
  steps: { primitive: string }[],
  action: "remixVisuals" | "regenerateCopy",
): boolean {
  if (action === "remixVisuals") {
    return steps.some(
      (s) => !COPY_PRIMITIVES.has(s.primitive) && !ALWAYS_RERUN_PRIMITIVES.has(s.primitive),
    );
  }
  return steps.some((s) => COPY_PRIMITIVES.has(s.primitive));
}

export function RemixActions({
  jobId,
  formatId,
  steps,
}: {
  jobId: Id<"jobs">;
  formatId: string;
  steps: { primitive: string }[];
}) {
  const remix = useMutation(api.remix.remix);
  const router = useRouter();
  const [busy, setBusy] = useState<"remixVisuals" | "regenerateCopy" | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (GATED_FORMATS.has(formatId)) {
    return (
      <p className="mt-6 text-xs text-muted">
        Remix isn&rsquo;t available yet for this format -- its approval gates
        mean a regenerated step could invalidate steps after it.
      </p>
    );
  }

  async function run(action: "remixVisuals" | "regenerateCopy") {
    setBusy(action);
    setError(null);
    try {
      const newJobId = await remix({ jobId, action });
      router.push(`/jobs/${newJobId}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(null);
    }
  }

  const canRemixVisuals = isMeaningful(steps, "remixVisuals");
  const canRegenerateCopy = isMeaningful(steps, "regenerateCopy");

  return (
    <div className="mt-6 flex flex-wrap items-center gap-2">
      <button
        onClick={() => run("remixVisuals")}
        disabled={!canRemixVisuals || busy !== null}
        title={canRemixVisuals ? "Keep the copy, regenerate everything visual" : "Nothing to regenerate -- this format has no separate visual step"}
        className="rounded-lg border border-line px-3 py-1.5 text-xs font-semibold hover:border-accent disabled:cursor-not-allowed disabled:opacity-40"
      >
        {busy === "remixVisuals" ? "Remixing…" : "Remix only"}
      </button>
      <button
        onClick={() => run("regenerateCopy")}
        disabled={!canRegenerateCopy || busy !== null}
        title={canRegenerateCopy ? "Keep the visuals, rewrite the copy" : "This format has no copy step to regenerate"}
        className="rounded-lg border border-line px-3 py-1.5 text-xs font-semibold hover:border-accent disabled:cursor-not-allowed disabled:opacity-40"
      >
        {busy === "regenerateCopy" ? "Regenerating…" : "Regenerate copy only"}
      </button>
      {error && <p className="w-full text-xs text-accent">{error}</p>}
    </div>
  );
}
