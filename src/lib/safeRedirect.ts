/**
 * Guards the `next` query param against an open redirect: only a same-origin
 * relative path is accepted. `new URL("https://evil.com", origin)` resolves
 * to the absolute attacker URL rather than the origin, so a bare
 * `next.startsWith("/")` isn't enough on its own -- `//evil.com` and
 * `/\evil.com` are both browser tricks for a scheme-relative URL that a
 * relative-path check alone would let through.
 */
export function safeNextPath(next: string | null | undefined, fallback = "/"): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) {
    return fallback;
  }
  return next;
}
