"use client";

import Link from "next/link";
import { useAction, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import type { WallDesign } from "../../../convex/lib/wallOfTextDesign";
import { Row, WallStudio } from "./WallStudio";

interface HookConfig {
  demoVideo?: string;
  audio?: string | null;
  mentionBusiness?: boolean;
}

/** The two hook + demo formats that caption their hook here. */
const FORMATS = {
  "video-hook-demo": { icon: "🪝", title: "Video Hook & Demo", on: "your hook" },
  "speaking-hook-demo": { icon: "📣", title: "Speaking Hook & Demo", on: "your speaker" },
} as const;

/**
 * The hook + demo formats' caption editor: the job page while the run waits
 * at its "style" gate, with the hook it will open on already made. It is Wall
 * of Text's studio -- the same fonts, colours, stroke, background, box width
 * and placement, previewed from the same style functions the render uses --
 * over the hook, looping just the seconds of it the video keeps.
 */
export function HookCaptionStudio({
  formatId,
  jobId,
  config,
  output,
  onSaved,
}: {
  formatId: keyof typeof FORMATS;
  jobId: Id<"jobs">;
  config: HookConfig;
  output: {
    design: WallDesign;
    videoUrl: string | null;
    audioUrl: string | null;
    previewSeconds?: number | null;
  };
  onSaved?: (schedule: boolean) => void;
}) {
  const improve = useAction(api.videoHookDemo.improveCaption);
  const format = FORMATS[formatId];

  return (
    <WallStudio
      jobId={jobId}
      config={config}
      output={output}
      onSaved={onSaved}
      variant={{
        icon: format.icon,
        title: format.title,
        hint: `Edit and style the caption on ${format.on}, then save to render.`,
        summary: <HookSummary formatId={formatId} config={config} hookUrl={output.videoUrl} />,
        rewriteLabel: "Improvise",
        rewrite: async (current) =>
          (await improve({ caption: current, mentionBusiness: Boolean(config.mentionBusiness) })).caption,
        words: { min: 10, max: 12 },
        overlays: false,
        allowEmpty: true,
      }}
    />
  );
}

function HookSummary({
  formatId,
  config,
  hookUrl,
}: {
  formatId: string;
  config: HookConfig;
  hookUrl: string | null;
}) {
  const demo = useQuery(
    api.assets.urlsFor,
    config.demoVideo ? { assetIds: [config.demoVideo as Id<"assets">] } : "skip",
  );
  const demoUrl = demo?.[0]?.url ?? null;
  const brand = useQuery(api.brands.mine);

  return (
    <section className="self-start rounded-2xl border border-line bg-surface">
      <div className="flex items-center justify-between px-4 pb-2 pt-3.5">
        <h2 className="text-sm font-semibold">Summary</h2>
        <Link href={`/new/${formatId}`} className="text-xs text-muted hover:text-accent">
          ‹ New video
        </Link>
      </div>
      <dl className="divide-y divide-line text-sm">
        <Row label="Hook · caption goes here">
          <Thumb url={hookUrl} />
        </Row>
        <Row label="Then your demo">
          <Thumb url={demoUrl} />
        </Row>
        <Row label="Audio">
          {config.audio ? (config.audio.startsWith("template:") ? "Library track" : "Your upload") : "Original sound"}
        </Row>
        <Row label="Mention your business">
          {config.mentionBusiness ? (brand?.name ? `Yes · ${brand.name}` : "Yes") : "No"}
        </Row>
      </dl>
      <p className="px-4 pb-3.5 pt-1 text-xs leading-snug text-muted">
        The caption shows over the hook only, then the video cuts to your demo. Clear the text to render
        without one.
      </p>
    </section>
  );
}

function Thumb({ url }: { url: string | null }) {
  return url ? (
    <video
      src={`${url}#t=0.1`}
      muted
      playsInline
      preload="metadata"
      className="aspect-[9/16] w-9 rounded-md bg-black object-cover"
    />
  ) : (
    <span className="text-muted">—</span>
  );
}
