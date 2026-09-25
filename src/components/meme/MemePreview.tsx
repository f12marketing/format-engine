"use client";

import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { defaultMemeLayer, looksKeyable, memeCaptionDesign, parseMemePick } from "../../../convex/lib/memeDesign";
import { WallStage, type StageMeme } from "../wall/WallStage";

/**
 * The config page's right-hand panel for Green Screen Meme: the video as it
 * will start out in the editor -- the background, the meme where it lands
 * first, and the hook caption in its starting look -- drawn by the editor's
 * own stage, so choosing things here already looks like the result.
 */
export function MemePreview({ values }: { values: Record<string, unknown> }) {
  const bgId = typeof values.background === "string" && values.background ? values.background : null;
  const bg = useQuery(api.assets.mediaInfo, bgId ? { assetId: bgId as Id<"assets"> } : "skip");
  const pick = parseMemePick(values.meme);
  const upload = useQuery(
    api.assets.mediaInfo,
    pick?.source === "upload" ? { assetId: pick.assetId as Id<"assets"> } : "skip",
  );
  const caption = typeof values.caption === "string" ? values.caption.trim() : "";

  const meme: StageMeme | null =
    pick?.source === "klipy"
      ? { url: pick.previewUrl, isVideo: pick.isVideo, aspect: pick.width && pick.height ? pick.width / pick.height : 1 }
      : pick?.source === "upload" && upload?.url
        ? { url: upload.url, isVideo: upload.isVideo, aspect: upload.width && upload.height ? upload.width / upload.height : 1 }
        : null;

  const hasSound = pick?.source === "klipy" ? pick.hasSound : Boolean(upload?.isVideo);
  const design = memeCaptionDesign(
    caption,
    defaultMemeLayer({
      keyable: looksKeyable(pick),
      sound: hasSound ? "meme" : bg?.isVideo ? "background" : "meme",
    }),
  );

  return (
    <div className="flex flex-col items-center gap-3">
      <WallStage
        design={design}
        videoUrl={bg?.isVideo ? bg.url : null}
        posterUrl={bg && !bg.isVideo ? bg.url : null}
        meme={meme}
        width={280}
        placeholder={pick ? "Your hook caption — or we'll write one" : "Your hook caption"}
      />
      <p className="max-w-[280px] text-center text-xs leading-snug text-muted">
        {!bgId && !pick
          ? "Pick a photo or video and a meme to see them together."
          : "A starting point: you'll move, size and key the meme and style the caption in the editor before it renders."}
      </p>
    </div>
  );
}
