"use client";

import { useEffect } from "react";

/**
 * Loads a Google Fonts stylesheet once per URL, for as long as the page lives.
 *
 * The studio previews text in the face the render will use, so the browser
 * needs the same stylesheet the render page links -- `googleFontsHref` builds
 * both. Links are never removed: switching back to a font already loaded
 * should be instant, and a stylesheet or two is nothing to keep around.
 */
export function useGoogleFont(href: string | null) {
  useEffect(() => {
    if (!href) return;
    const id = `gf-${href}`;
    if (document.getElementById(id)) return;
    const link = document.createElement("link");
    link.id = id;
    link.rel = "stylesheet";
    link.href = href;
    document.head.appendChild(link);
  }, [href]);
}
