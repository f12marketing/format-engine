/**
 * Whether a KLIPY meme may be rendered into a video.
 *
 * KLIPY's API terms have their media shown in the browser, from the URLs
 * their API returns. Burning a meme into a video means the render service
 * fetching it server-side, which needs KLIPY's written OK
 * (developers@klipy.com). Until then the popup still browses and previews
 * KLIPY -- that part is browser-side, as the terms want -- but a job whose
 * meme is from KLIPY is refused at Generate and again at render. Uploaded
 * memes don't involve KLIPY and always render.
 *
 * Once KLIPY approves, on the deployment that has the approval:
 *   npx convex env set KLIPY_SERVER_RENDER_APPROVED true
 */
export function klipyServerRenderApproved(): boolean {
  return (process.env.KLIPY_SERVER_RENDER_APPROVED ?? "").trim().toLowerCase() === "true";
}

export const KLIPY_RENDER_BLOCKED =
  "KLIPY memes can't be made into videos yet: KLIPY's terms only cover showing them in the app until " +
  "KLIPY approves rendering them. Pick one from My memes, or upload your own.";
