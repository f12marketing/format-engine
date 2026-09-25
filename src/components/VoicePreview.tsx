"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useAction, useConvexAuth, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { voiceSample, voiceSampleCostUsd } from "../../convex/lib/voiceSample";

/**
 * Samples already fetched this session, by what they were generated from.
 * Going back to a voice you've already heard replays it instantly and costs
 * nothing -- which is most of what auditioning twenty-one voices is.
 */
const heard = new Map<string, string>();

/**
 * A voice select with a button beside it that plays one short line in the
 * selected voice, so a narrator can be picked by ear before a run spends
 * anything on a whole script.
 *
 * `children` is the select itself; this adds the button and its error line
 * around it. The caller gives this a `key` built from the voice, delivery and
 * language, so changing any of them remounts it: playback stops and the button
 * resets, with no in-flight state to reconcile against a new selection.
 *
 * The button only appears for an admitted client. Its fallback is nothing --
 * unlike the upload and roster pickers, a signed-out visitor still has a
 * working select here, and a "sign in to see this" box beside it would be
 * louder than the control it replaces.
 */
export function VoicePreview({
  voice,
  stability,
  language,
  children,
}: {
  voice: string;
  stability?: string;
  language?: string;
  children: ReactNode;
}) {
  const { isAuthenticated } = useConvexAuth();
  const me = useQuery(api.clients.me, isAuthenticated ? {} : "skip");
  const preview = useAction(api.voicePreview.preview);

  const [state, setState] = useState<"idle" | "loading" | "playing">("idle");
  const [error, setError] = useState<string | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);
  // False once unmounted, so a slow response for a voice that has since been
  // swapped out doesn't start playing over the new selection.
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      audio.current?.pause();
    };
  }, []);

  if (!isAuthenticated || !me || me.archived) return <>{children}</>;

  const cacheKey = `${voice}|${stability ?? ""}|${language ?? ""}`;
  const cached = heard.has(cacheKey);
  const price = voiceSampleCostUsd(language);
  const line = voiceSample(language).text;

  function stop() {
    audio.current?.pause();
    audio.current = null;
    setState("idle");
  }

  async function toggle() {
    if (state === "playing") return stop();
    if (state === "loading") return;

    setError(null);
    try {
      let url = heard.get(cacheKey);
      if (!url) {
        setState("loading");
        url = (await preview({ voice, voiceStability: stability, language })).url;
        heard.set(cacheKey, url);
      }
      if (!alive.current) return;

      const el = new Audio(url);
      audio.current = el;
      el.onended = () => {
        if (audio.current !== el) return;
        audio.current = null;
        setState("idle");
      };
      el.onerror = () => {
        if (audio.current !== el) return;
        audio.current = null;
        setError("Couldn't play the sample.");
        setState("idle");
      };
      setState("playing");
      await el.play();
    } catch (e) {
      if (!alive.current) return;
      audio.current = null;
      setState("idle");
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div>
      <div className="flex items-stretch gap-2">
        <div className="min-w-0 flex-1">{children}</div>
        <button
          type="button"
          onClick={() => void toggle()}
          disabled={state === "loading"}
          aria-label={state === "playing" ? `Stop the ${voice} sample` : `Play a sample of ${voice}`}
          title={`Says “${line}”${cached ? "" : ` · costs about $${price.toFixed(3)}`}`}
          className="flex shrink-0 items-center gap-1.5 rounded-lg border border-line bg-surface-sub px-3 py-2 text-sm hover:border-accent disabled:cursor-wait disabled:opacity-60"
        >
          <span aria-hidden>{state === "playing" ? "■" : state === "loading" ? "…" : "▶"}</span>
          <span>{state === "playing" ? "Stop" : state === "loading" ? "Loading" : "Preview"}</span>
          {!cached && state === "idle" && (
            <span className="font-mono text-[0.6rem] text-muted">${price.toFixed(3)}</span>
          )}
        </button>
      </div>
      {error && (
        <p role="alert" className="mt-1 text-xs text-accent">
          {error}
        </p>
      )}
    </div>
  );
}
