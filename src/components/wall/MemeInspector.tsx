"use client";

import { useId } from "react";
import type { MemeLayer, MemeSound } from "../../../convex/lib/wallOfTextDesign";
import { MEME_SECONDS } from "../../../convex/lib/memeDesign";
import { ChromaFilter, memeLook } from "./WallStage";
import { Section, Segmented, Slider, SmallButton } from "./WallStudio";

/** Green Screen Meme's meme, as the studio's run output describes it. */
export interface StudioMeme {
  url: string;
  isVideo: boolean;
  /** Width over height. */
  aspect: number;
  title: string;
  hasSound: boolean;
  source: "klipy" | "upload";
}

/**
 * The meme's inspector in the studio: everything about the meme that isn't
 * dragging it -- its size, a few one-tap placements, mirroring, keying out a
 * green screen, whose sound the video keeps and, over a photo, how long the
 * video runs. Each change is one undo step, like the text's.
 */
export function MemeInspector({
  layer,
  meme,
  backgroundIsVideo,
  update,
  onDone,
}: {
  layer: MemeLayer;
  meme: StudioMeme;
  backgroundIsVideo: boolean;
  update: (patch: Partial<MemeLayer>, key: string) => void;
  onDone: () => void;
}) {
  const chromaId = `chroma-inspect-${useId().replace(/:/g, "")}`;

  return (
    <div className="divide-y divide-line">
      <Section title="Meme">
        <div className="grid h-32 place-items-center overflow-hidden rounded-lg border border-line bg-[conic-gradient(#e7e1e5_25%,#fff_0_50%,#e7e1e5_0_75%,#fff_0)] bg-[length:16px_16px]">
          {layer.chroma && <ChromaFilter id={chromaId} />}
          <div style={{ aspectRatio: meme.aspect || 1 }} className="max-h-full max-w-full">
            {meme.isVideo ? (
              <video src={meme.url} muted autoPlay loop playsInline style={memeLook(layer, chromaId)} />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={meme.url} alt="" style={memeLook(layer, chromaId)} />
            )}
          </div>
        </div>
        <div className="flex items-center justify-between gap-2">
          <p className="min-w-0 truncate text-xs font-medium">{meme.title || "Your meme"}</p>
          {meme.source === "klipy" && (
            <span className="shrink-0 text-[0.6rem] text-muted">
              via <strong className="font-extrabold tracking-tight text-foreground">KLIPY</strong>
            </span>
          )}
        </div>
      </Section>

      <Section title="Size & place">
        <Slider
          label="Size"
          value={Math.round(layer.w * 100)}
          min={10}
          max={160}
          display={`${Math.round(layer.w * 100)}%`}
          onChange={(w) => update({ w: w / 100 }, "size")}
        />
        <div className="grid grid-cols-3 gap-2">
          {(
            [
              ["Top", 0.3],
              ["Middle", 0.52],
              ["Bottom", 0.74],
            ] as const
          ).map(([label, y]) => (
            <button
              key={label}
              type="button"
              onClick={() => update({ y, x: 0.5 }, `place-${Date.now()}`)}
              className="rounded-lg border border-line py-1.5 text-xs text-muted hover:border-accent hover:text-foreground"
            >
              {label}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          <SmallButton onClick={() => update({ x: 0.5 }, `centre-${Date.now()}`)}>Centre</SmallButton>
          <SmallButton onClick={() => update({ x: 0.5, w: 1 }, `fill-${Date.now()}`)}>Full width</SmallButton>
          <SmallButton onClick={() => update({ flip: !layer.flip }, `flip-${Date.now()}`)}>
            {layer.flip ? "Unflip" : "Flip ↔"}
          </SmallButton>
        </div>
        <p className="text-xs text-muted">Drag it on the video to move it; drag the corner dot to resize.</p>
      </Section>

      <Section title="Green screen">
        <label className="flex cursor-pointer items-start gap-3">
          <button
            type="button"
            role="switch"
            aria-checked={layer.chroma}
            onClick={() => update({ chroma: !layer.chroma }, `chroma-${Date.now()}`)}
            className={[
              "relative mt-0.5 h-5 w-9 shrink-0 rounded-full transition-colors",
              layer.chroma ? "bg-accent" : "bg-line-strong",
            ].join(" ")}
          >
            <span
              className={[
                "absolute left-0.5 top-0.5 size-4 rounded-full bg-white shadow transition-transform",
                layer.chroma ? "translate-x-4" : "translate-x-0",
              ].join(" ")}
            />
          </button>
          <span className="text-xs leading-snug">
            <span className="block font-medium">Remove the green screen</span>
            <span className="text-muted">
              Keys out the green behind the meme, so your background shows through. Leave off for a regular GIF.
            </span>
          </span>
        </label>
      </Section>

      <Section title="Sound">
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs text-muted">The video keeps</span>
          <Segmented<MemeSound>
            value={layer.sound}
            onChange={(sound) => update({ sound }, `sound-${Date.now()}`)}
            options={[
              { value: "meme", label: <SoundLabel>Meme</SoundLabel>, title: "The meme's own sound" },
              ...(backgroundIsVideo
                ? [{ value: "background" as const, label: <SoundLabel>Video</SoundLabel>, title: "Your video's sound" }]
                : []),
              { value: "none", label: <SoundLabel>Off</SoundLabel>, title: "No sound" },
            ]}
          />
        </div>
        {layer.sound === "meme" && !meme.hasSound && (
          <p className="text-xs text-muted">This meme is silent{backgroundIsVideo ? " — pick Video to keep yours." : "."}</p>
        )}
      </Section>

      {!backgroundIsVideo && (
        <Section title="Length">
          <label className="flex cursor-pointer items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={layer.seconds === null}
              onChange={(e) => update({ seconds: e.target.checked ? null : 6 }, `len-auto-${Date.now()}`)}
              className="size-4 accent-accent"
            />
            <span>Automatic — the meme loops to about 6 seconds</span>
          </label>
          {layer.seconds !== null && (
            <Slider
              label="Video length"
              value={layer.seconds}
              min={MEME_SECONDS.min}
              max={MEME_SECONDS.max}
              display={`${layer.seconds}s`}
              onChange={(seconds) => update({ seconds }, "length")}
            />
          )}
        </Section>
      )}
      {backgroundIsVideo && (
        <Section title="Length">
          <p className="text-xs text-muted">Your video sets the length (up to a minute); the meme loops over it.</p>
        </Section>
      )}

      <div className="p-4">
        <button type="button" onClick={onDone} className="w-full rounded-lg border border-line py-2 text-xs hover:border-accent">
          ← Back to the caption
        </button>
      </div>
    </div>
  );
}

function SoundLabel({ children }: { children: React.ReactNode }) {
  return <span className="px-1 text-[0.68rem] font-medium">{children}</span>;
}
