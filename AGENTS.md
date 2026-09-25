<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Working on Format Engine

`README.md` is the map: every format, the setup, the deploy checklist and the
file layout. Read it before changing a format. This section covers what an
agent or new developer needs on top of that.

**Two repos.** This one holds the app and the Convex backend. `../render-service`
is a separate git repo, the Chrome + ffmpeg service deployed to Railway. It
runs locally on `:4000`:
- A change to a render route only takes effect after that process is
  restarted, and on production after a Railway redeploy.
- To test a render change, start a second copy on a spare port
  (`PORT=4411 npm start`) and call it with curl, rather than killing the
  instance the user may be using.
- Formats that depend on a newer route detect an old service and fail with a
  message saying to restart it. Keep that pattern when adding one.

**Formats are data.**
- `src/formats/` declares each format's config fields and pipeline with
  `defineFormat`. `ConfigPanel`, the cost estimate and the Convex workflow all
  read that declaration.
- Step conditions (`when`, `showWhen`) are plain objects, never functions.
- Each format's run is `convex/<format>.ts`.
- A step with `gate: true` pauses the job. For the studio formats that is the
  `style` step, and `STUDIO_STEP` in `src/app/jobs/[jobId]/JobView.tsx` decides
  which editor it opens.
- Anything a studio saves is re-checked server-side (`sanitizeDesign`,
  `sanitizeMemeDesign`) before it reaches a render.

**Don't break old jobs.** When a format changes shape, jobs created earlier
still run their old path. For example, Green Screen Meme's `clip` step and
Speaking Hook & Demo's `captionStyle` burn-in are still handled. Keep these
branches unless the old jobs are gone.

**Money.**
- Every paid call is checked against the client's spend cap (`convex/ledger.ts`).
- A new paid step needs its price in `src/lib/estimate.ts`.
- Test runs spend real fal credit, so prefer free paths: a hook from My
  videos, a typed caption, an uploaded meme.
- Toggles like *Mention your business* and buttons like *Improvise* make LLM
  calls.

**Third-party terms.** KLIPY (memes) and Pexels/Pixabay (stock photos) come
with usage rules. The README lists each rule and the code that follows it.
Keep them when touching `src/lib/klipy.ts`, `src/components/meme/`,
`convex/lib/memeDesign.ts` or `convex/imageSets.ts`.

**Secrets.**
- Server keys live in the Convex deployment (`npx convex env set`). Never put
  them in `.env.local` or in code.
- Only `NEXT_PUBLIC_*` values belong in `.env.local`.
- Never ask for keys in chat.

**Before you commit.**
- Run `npx tsc --noEmit` and `npm run lint`. The React hooks rules are strict:
  no `Date.now()` during render, and no synchronous `setState` in an effect.
- Keep `npx convex dev` running so `convex/_generated/` stays current. Commit
  any change it makes to `api.d.ts` along with your code.
- The working copy is Windows with `core.autocrlf=true`, so files are CRLF on
  disk. Scripted edits must keep line endings.
- Several agent sessions often share this working tree. Check `git status`
  and `git diff` first, stage only your own hunks, and never commit, revert
  or reformat someone else's uncommitted work.
- Branch off `master` and open PRs on `f12marketing/format-engine`.
