"use client";

import Link from "next/link";
import { useAction, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import type { WallDesign } from "../../../convex/lib/wallOfTextDesign";
import { Row, WallStudio } from "./WallStudio";
import type { StudioMeme } from "./MemeInspector";

interface MemeConfig {
  mentionBusiness?: boolean;
}

/**
 * Green Screen Meme's editor: the job page while the run waits at its "style"
 * gate. It is Wall of Text's studio -- the same fonts, colours, stroke,
 * backgrounds, text boxes, placement and undo -- with the meme as a layer of
 * its own: dragged, resized from the corner, flipped and keyed, over the
 * client's photo or video. The caption's Improvise writes to the meme.
 */
export function MemeStudio({
  jobId,
  config,
  output,
  onSaved,
}: {
  jobId: Id<"jobs">;
  config: MemeConfig;
  output: {
    design: WallDesign;
    videoUrl: string | null;
    posterUrl: string | null;
    audioUrl: string | null;
    previewSeconds?: number | null;
    meme: StudioMeme;
  };
  onSaved?: (schedule: boolean) => void;
}) {
  const improve = useAction(api.greenScreenMeme.improveCaption);

  return (
    <WallStudio
      jobId={jobId}
      config={config}
      output={output}
      onSaved={onSaved}
      variant={{
        icon: "🟩",
        title: "Green Screen Meme",
        hint: "Place your meme, then style the hook caption — save to render.",
        summary: <MemeSummary config={config} output={output} />,
        rewriteLabel: "Improvise",
        rewrite: async (current) =>
          (
            await improve({
              caption: current,
              memeTitle: output.meme.title || undefined,
              mentionBusiness: Boolean(config.mentionBusiness),
            })
          ).caption,
        words: { min: 5, max: 14 },
        overlays: false,
        allowEmpty: true,
      }}
    />
  );
}

function MemeSummary({
  config,
  output,
}: {
  config: MemeConfig;
  output: { videoUrl: string | null; posterUrl: string | null; meme: StudioMeme };
}) {
  const brand = useQuery(api.brands.mine);
  const bg = output.videoUrl ?? output.posterUrl;

  return (
    <section className="self-start rounded-2xl border border-line bg-surface">
      <div className="flex items-center justify-between px-4 pb-2 pt-3.5">
        <h2 className="text-sm font-semibold">Summary</h2>
        <Link href="/new/green-screen-meme" className="text-xs text-muted hover:text-accent">
          ‹ New video
        </Link>
      </div>
      <dl className="divide-y divide-line text-sm">
        <Row label={output.videoUrl ? "Your video" : "Your photo"}>
          {bg ? (
            output.videoUrl ? (
              <video src={`${bg}#t=0.1`} muted playsInline preload="metadata" className="aspect-[9/16] w-9 rounded-md bg-black object-cover" />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={bg} alt="" className="aspect-[9/16] w-9 rounded-md bg-black object-cover" />
            )
          ) : (
            <span className="text-muted">—</span>
          )}
        </Row>
        <Row label={output.meme.source === "klipy" ? "Meme · via KLIPY" : "Meme · yours"}>
          <span className="grid size-9 place-items-center overflow-hidden rounded-md bg-[conic-gradient(#e7e1e5_25%,#fff_0_50%,#e7e1e5_0_75%,#fff_0)] bg-[length:10px_10px]">
            {output.meme.isVideo ? (
              <video src={output.meme.url} muted autoPlay loop playsInline className="size-full object-contain" />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={output.meme.url} alt="" className="size-full object-contain" />
            )}
          </span>
        </Row>
        {output.meme.title && (
          <div className="px-4 py-2.5">
            <dt className="text-xs font-medium text-muted">Meme</dt>
            <dd className="mt-0.5 line-clamp-2 text-sm leading-snug">{output.meme.title}</dd>
          </div>
        )}
        <Row label="Mention your business">
          {config.mentionBusiness ? (brand?.name ? `Yes · ${brand.name}` : "Yes") : "No"}
        </Row>
      </dl>
      <p className="px-4 pb-3.5 pt-1 text-xs leading-snug text-muted">
        Click the meme to size, flip or key it, and pick whose sound plays. Clear the caption to render without one.
      </p>
      {output.meme.source === "klipy" && (
        <p className="border-t border-line px-4 py-2.5 text-[0.65rem] text-muted">
          Powered by <strong className="font-extrabold tracking-tight text-foreground">KLIPY</strong>
        </p>
      )}
    </section>
  );
}
