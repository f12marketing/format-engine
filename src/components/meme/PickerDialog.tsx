"use client";

import { useEffect, useState } from "react";
import { UploadIcon } from "../AvatarField";

/**
 * The Green Screen Meme popups' frame, drawn like the demo video popup: a
 * dimmed, blurred backdrop, a title and a line under it, a tab row, a
 * scrolling body and an optional footer. Escape or a click outside closes it,
 * and the page behind holds still while it's open.
 */
export function PickerDialog({
  title,
  blurb,
  tabs,
  footer,
  onClose,
  children,
  wide,
}: {
  title: string;
  blurb: string;
  tabs: React.ReactNode;
  footer?: React.ReactNode;
  onClose: () => void;
  children: React.ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
    };
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/45 p-3 backdrop-blur-[3px] sm:p-6" onPointerDown={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onPointerDown={(e) => e.stopPropagation()}
        className={[
          "flex max-h-[90vh] w-full animate-[quiz-in_220ms_ease-out] flex-col overflow-hidden rounded-3xl border border-line bg-surface shadow-2xl",
          wide ? "max-w-5xl" : "max-w-4xl",
        ].join(" ")}
      >
        <header className="flex shrink-0 items-start gap-4 px-5 pt-5 sm:px-7 sm:pt-6">
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
            <p className="mt-0.5 text-sm text-muted">{blurb}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="grid size-9 shrink-0 place-items-center rounded-full text-muted hover:bg-surface-sub hover:text-foreground"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
              <path d="M6 6l12 12M18 6 6 18" />
            </svg>
          </button>
        </header>
        <nav
          className="mt-4 flex shrink-0 items-end gap-1 overflow-x-auto px-3 shadow-[inset_0_-1px_0_var(--line)] sm:px-5"
          role="tablist"
        >
          {tabs}
        </nav>
        <div className="min-h-[340px] flex-1 overflow-y-auto px-5 py-5 sm:px-7">{children}</div>
        {footer && <footer className="shrink-0 border-t border-line px-5 py-3 sm:px-7">{footer}</footer>}
      </div>
    </div>
  );
}

export function TabButton({
  on,
  onClick,
  children,
}: {
  on: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={on}
      onClick={onClick}
      className={[
        "shrink-0 whitespace-nowrap border-b-2 px-3 py-2.5 text-sm transition",
        on ? "border-accent font-semibold text-accent" : "border-transparent text-muted hover:text-foreground",
      ].join(" ")}
    >
      {children}
    </button>
  );
}

/** A small caps label between tab groups: "KLIPY" | "Yours". */
export function TabGroup({ children }: { children: React.ReactNode }) {
  return (
    <span className="mb-3 ml-2 mr-1 shrink-0 font-mono text-[0.58rem] uppercase tracking-[0.14em] text-muted/80 first:ml-0">
      {children}
    </span>
  );
}

/** The drop zone every upload tab uses. */
export function DropZone({
  busy,
  onPick,
  onFile,
  title,
  hint,
}: {
  busy: boolean;
  onPick: () => void;
  onFile: (file: File) => void;
  title: string;
  hint: string;
}) {
  const [dragging, setDragging] = useState(false);
  return (
    <button
      type="button"
      onClick={onPick}
      disabled={busy}
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        const file = e.dataTransfer.files?.[0];
        if (file) onFile(file);
      }}
      className={[
        "flex min-h-[300px] w-full flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed px-6 text-center transition disabled:opacity-60",
        dragging
          ? "border-accent bg-accent-soft text-accent"
          : "border-line-strong text-muted hover:border-accent hover:bg-accent-soft hover:text-accent",
      ].join(" ")}
    >
      <span className="grid size-12 place-items-center rounded-full bg-surface-sub">
        {busy ? <span className="size-5 animate-spin rounded-full border-2 border-accent border-t-transparent" /> : <UploadIcon />}
      </span>
      <span className="text-sm font-semibold">{busy ? "Uploading…" : title}</span>
      <span className="max-w-sm text-xs">{hint}</span>
    </button>
  );
}

/** The ✓ on a picked tile. */
export function PickedTick() {
  return (
    <span className="pointer-events-none absolute bottom-2 right-2 grid size-6 place-items-center rounded-full bg-accent text-white shadow">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M5 12.5 10 17 19 7" />
      </svg>
    </span>
  );
}

/** A transparent-looking ground, so a sticker's cut-out edges show. */
export const CHECKER =
  "bg-[conic-gradient(#e9e4e8_25%,#fff_0_50%,#e9e4e8_0_75%,#fff_0)] bg-[length:14px_14px] dark:bg-[conic-gradient(#2a2630_25%,#1d1a22_0_50%,#2a2630_0_75%,#1d1a22_0)]";
