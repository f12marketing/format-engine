# Format Engine

Twenty-four content formats behind one picker: decks, slideshows, trending-clip
remixes, talking avatars, generated stop-motion and documentary scenes, short
drama episodes, character swaps. The successor to `../app`, built on Convex +
Vercel + Railway + fal.ai, with Supabase Auth and Zernio for posting. See the
implementation plan for the why:
https://claude.ai/code/artifact/1295e505-faca-4d71-b58e-8093a96e5ced

## What works today

```bash
npm run dev
```

- **`/`** — "Create new content": every format on one grid. A format still
  marked `planned` would stay visible but unclickable.
- **`/new/<formatId>`** — configuration left, preview right. The panel is
  generated entirely from the format's declaration; nothing in it knows what a
  carousel or a drama episode is.
- **`/jobs/<jobId>`** — a running or finished job: step-by-step progress,
  approval gates, the output, and Remix / Regenerate copy.
- **`/influencers`** — the influencer roster. Create one from a gallery face or
  from your own photos (LoRA training runs on fal and reports back through a
  webhook).
- **`/library`** — three tabs: My Posts, My Content (what the engine
  generated) and My Media Bank (what you uploaded).
- **`/history`** — every job, paginated.
- **`/calendar`**, **`/analytics`**, **`/connections`** — schedule posts,
  read performance, and link TikTok / Instagram / YouTube / LinkedIn accounts,
  all through Zernio.
- The cost estimate is **live and real** — it walks the format's declared
  pipeline, skips steps whose conditions don't hold, and prices each primitive
  at published fal rates.
- Spend is **capped per client** (`clients.monthlySpendCapUsd`, default $50)
  and checked before each paid step.

The format grid, config panels and estimates all work with zero accounts. Signing
in, uploading, and Generate need the setup below.

### The formats

All 24 are declared `ready` in the registry (`src/formats/index.ts`). Each has
its own Convex pipeline file under `convex/`.

| Group | Formats |
| --- | --- |
| Decks | Carousel |
| Slides & text | Slideshow, Wall of Text |
| Trending clips | Video Hook & Demo, Green Screen Meme |
| Talking avatars | Talking Head UGC, Speaking Hook & Demo, Talking Head Green Screen, Product Spokesperson, Green Screen Mobile with App |
| Generated scenes | Video Animation, Drama, Cutting Fruit, On a Walk, Netflix Documentary, Claymation, Lego, Felt, Skeleton, Talking Objects, Street Interview, AI News Anchor |
| Swap & custom | Character Swap, Custom |

A few things are worth knowing about before you touch them:

- **Drama** runs premise → episode → cast → storyboard → dialogue → filmed
  beats → score → final cut. It is the most expensive format by a wide margin
  (roughly $12–13 for a 45-second episode) and it needs the render service's
  `/render/drama` route.
- **Wall of Text** lays one paragraph over a casual phone clip for the whole
  video (the confession / "POV:" post). The Video field is the same casting
  popup every person-in-the-video format uses, plus a Videos tab: pick a
  person and the run stages them in a front-camera selfie (qwen edit) and
  films a 4-10s handheld clip (Kling Standard, ~$0.55 at 6s), saved to the
  client's videos for reuse; pick a clip and it is used as-is. The text is written from the Prompt
  and, with *Mention your business* on, from the client's business profile. The run then pauses in a
  studio on the job page where the text is styled and dragged into place;
  Save renders it, Schedule renders and opens the post composer. Preview and
  render share one style module (`convex/lib/wallOfTextDesign.ts`): the render
  service screenshots the page that module builds, so the video matches the
  studio. It needs the render service's `/render/wall-of-text` route with
  `layerHtml` support.
- **The business profile** is collected by a quiz every new client is sent
  to once after sign-up (`/onboarding`): name and logo (brand colours are read
  out of the logo), their website -- read server-side and drafted into a
  profile by the LLM (`convex/onboarding.ts`), or described by hand when the
  site blocks readers -- then role, team, business type, goals and how they
  heard about us. Progress saves per screen. It lives on the `brands` row and
  is editable on the **Business** page. Every format's *Mention your
  business* toggle writes from it through `convex/lib/businessContext.ts`, and
  Generate waits for a profile when the toggle is on.
- **Slideshow** and **Video Animation** are cut to their voiceover, so neither
  asks how long the video is. The **Script** is recorded first, in one take; if
  it runs X seconds, the video gets X ÷ 3 (rounded up) slides or shots, each on
  screen for exactly 3 seconds. A 60-second script is 20 scenes. Each scene is
  planned around the words actually being spoken during its 3 seconds, taken
  from the speech model's word timings (`convex/lib/scriptTiming.ts`,
  `convex/lib/scriptVoice.ts`), and the music, if on, is generated at the
  voiceover's length. The Script is required in both (there is nothing else to
  size the video by), and Generate stays disabled until it has text -- a field
  opts in with `required: true`, which is separate from `optional` (only the
  label's tag) so no other format is blocked by it. Scripts are capped
  at 1,500 characters (about 100 seconds, 34 scenes) and a video at 40 scenes,
  because every 3 seconds is a paid image or clip: a 60-second Slideshow is
  around $1.75, and a 60-second Video Animation (Kling Standard) about $6.50.
- The rest of the production extras — music, upscale, subtitles, branding — come
  from `convex/lib/extras.ts`, and the voiceover is always on for those two
  formats (it is what they are cut to), so it has no switch. Subtitles — the
  word-by-word text burned in from the voiceover — are the only text on those
  two videos (there are no separate per-slide or per-shot captions) and start
  switched on.
  The Voiceover **Voice** select has a **Preview** button that plays one short
  line in the chosen voice and Delivery (about $0.004 a listen, counted against
  the spend cap; a voice you've already heard this session replays free). Any
  format that spreads `extrasFields` gets it; a choice field opts in with
  `preview: "voice"`.

Every finished job offers **Remix only** (regenerate the visual steps, keep the
copy) and **Regenerate copy only** (the reverse). `convex/remix.ts` does this
once for every format by looking at each step's primitive.

## Setup — the parts only you can do

**Do not paste keys into a chat.** Everything below you run yourself; the
values live in files and in Convex's own env store. Two of Format Engine's keys
are *meant* to be public (Supabase's publishable key, `NEXT_PUBLIC_*` Convex
URLs) — the rest are not.

### 1. Convex

```bash
npx convex dev
```

No account needed to start: this provisions an **anonymous local backend** on
`127.0.0.1:3210` and writes `CONVEX_DEPLOYMENT` / `NEXT_PUBLIC_CONVEX_URL` into
`.env.local` itself. Leave it running — it watches and redeploys on save. Run
`npx convex login` later, whenever you want this promoted to a real hosted
deployment.

### 2. Supabase Auth

The frontend needs two **publishable** values in `.env.local` (copy
`.env.local.example`):

```
NEXT_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
```

Convex validates the JWT itself, so it needs the issuer and JWKS URL — set once
on the deployment, never in `.env.local`:

```bash
npx convex env set SUPABASE_JWT_ISSUER https://<project-ref>.supabase.co/auth/v1
npx convex env set SUPABASE_JWKS_URL   https://<project-ref>.supabase.co/auth/v1/.well-known/jwks.json
```

**This only works if the project has asymmetric JWT signing keys enabled**
(Supabase Dashboard → Authentication → JWT Keys). Convex's `customJwt`
provider verifies RS256 or ES256 only — a project still on the legacy shared
HS256 secret cannot use this integration. Check with:

```bash
curl https://<project-ref>.supabase.co/auth/v1/.well-known/jwks.json
```

A `keys` array with `"alg":"ES256"` or `"RS256"` means you're set. An empty
array or a 404 means the project needs JWT Signing Keys turned on first.

Sign-in is **email and password**, with sign-up and a forgot-password flow
(`/sign-in`, `/reset-password`). Add `http://localhost:3000/auth/callback` to
Supabase's redirect-URL allow-list (Dashboard → Authentication → URL
Configuration), and your production URL later — email confirmation and
password-reset links land there, and it's the one manual dashboard step behind
them.

### 3. Server-side keys on Convex

Never in `.env.local` — these belong to the deployment:

```bash
npx convex env set FAL_API_KEY <your fal key>
npx convex env set RENDER_SERVICE_URL http://localhost:4000
npx convex env set RENDER_SERVICE_API_KEY <a long random string>
```

`RENDER_SERVICE_API_KEY` must match the value the render service is started
with (step 4). The service fails closed — every route except `/health` returns
401 without it.

Optional, each unlocking one feature:

| Variable | Unlocks |
| --- | --- |
| `SCRAPECREATORS_API_KEY` | Ingesting TikTok clips into the trending library (Video Hook & Demo, Green Screen Meme) |
| `ZERNIO_API_KEY` | Connecting accounts, posting, the calendar and analytics |
| `ZERNIO_WEBHOOK_SECRET` | Post-status events at `/zernio/events`. Unset means the endpoint refuses every event rather than accepting unverifiable ones |

`ZERNIO_WEBHOOK_SECRET` and the fal training webhook (`/fal/training-complete`)
only matter where Convex is reachable from the internet. Locally, two crons —
one for influencer training, one for in-flight posts — poll for the same
results instead.

### Background music (optional)

The audio popup's **Platform** tab searches public-domain (CC0) music on
Freesound -- Pexels and Pixabay have no audio API. Get a free key at
https://freesound.org/apiv2/apply, then:

```bash
npx convex env set FREESOUND_API_KEY <your key>
```

Without it the tab says it isn't switched on, and uploads still work. A
picked track is copied into `audioTemplates` once (`convex/music.ts`), so a
job keeps its music even if the track later leaves Freesound.

### 4. Render service

```bash
cd ../render-service
npm install
RENDER_SERVICE_API_KEY=<the same string> npm start
```

Needs Chrome/Edge and ffmpeg; set `CHROME_BIN` / `FFMPEG_BIN` if either isn't
found automatically. **Restart it whenever this repo's Slideshow or Video Animation change:** they send a `voiceoverUrl` that an older service would silently ignore, leaving the video with no voice. So both formats check `/health` (which reports `voiceover: true` from current code) before spending anything, and stop with a message telling you to restart it. It serves the routes the formats call: `/render/carousel`,
`/render/wall-of-text`, `/render/slideshow`, `/render/video-animation`,
`/render/drama`, `/render/video-hook-demo`, `/render/green-screen-meme`,
`/render/picture-in-picture`, `/render/custom`, plus helpers for inspecting
video, extracting frames and audio, and packing images. `Dockerfile` +
`railway.json` are ready for a Railway deploy — see that repo's own README.

### 5. Admit yourself

Visit `/sign-in`, create an account, and confirm the email. The dashboard then
calls `clients:bootstrapFirstClient` automatically — it only ever creates a row
when the `clients` table is empty, so this admits exactly the first person who
ever signs in, and does nothing for anyone after.

Anyone can create a Supabase account, but a signed-in identity with no `clients`
row gets nothing. Add further clients as rows from the Convex dashboard;
there's no self-serve admission by design, and revoking access is a row edit.

### 6. Seed the shared libraries (optional)

The clip, audio and gallery-face libraries are shared across clients and are
curated from the CLI through `convex/dev.ts` (`internal*` functions, unreachable
from the browser) until there's an admin surface worth building. Nothing else
needs seeding.

## Layout

```
convex/
  schema.ts              clients, brands, avatars, assets, jobs, spend_ledger,
                         influencers, galleryFaces, houseImages, audioTemplates,
                         clips, socialAccounts, socialPosts, postAnalytics,
                         zernioWebhookEvents
  auth.config.ts         Supabase JWT verification (customJwt provider)
  clients.ts             invite-only resolution: JWT subject -> clients row
  ledger.ts              spend tracking + the pre-spend cap assertion
  run.ts / starters.ts   the Generate button, and the one table of every
                         format's workflow `start`
  remix.ts               Remix only / Regenerate copy only, for every format
  <format>.ts            one pipeline per format: carousel, slideshow, drama,
                         videoAnimation, claymation, skeleton, characterSwap ...
  influencers.ts         roster, LoRA training, the fal callback
  galleryFaces.ts        the curated base faces the New Influencer popup offers
  voicePreview.ts        the Preview button's action: one short TTS line
  audio.ts, clips.ts     the shared audio and trending-clip libraries
  social.ts, socialPosts.ts, analytics.ts
                         Zernio: connected accounts, posting, performance
  http.ts                /fal/training-complete and /zernio/events
  crons.ts               backstops for the two webhooks above
  lib/fal.ts             the fal.ai client: forced tool-calls, queue polling,
                         retry with backoff, content-policy fallback
  lib/*Primitive.ts      the shared pipeline steps (script, narration, speech,
                         avatar, scene, animate)
  lib/grounding.ts       makes a topic true to the real world before any image
                         model draws it
  lib/extras.ts          music, upscale, subtitles, branding
  lib/scriptTiming.ts    script -> scene count (X / 3) and the words in each scene
  lib/scriptVoice.ts     writes a script from an idea; records it with word timings
  lib/carouselPrompt.ts  the tuned prompt, ported unchanged — three eval rounds
                         went into these numbers
  lib/renderService.ts   base URL + auth headers for every render-service call
  lib/nodeStorage.ts     the one "use node" place that decodes and stores
                         render output
  dev.ts                 CLI-only seeding/inspection
src/
  formats/
    types.ts             defineFormat, the ten primitives, step conditions
    fields.ts            the recurring field types
    carousel.ts, slideshow.ts, videoAnimation.ts, drama.ts, extras.ts,
    planned.ts           all 24 formats declared
    index.ts             the registry — the single source of truth
  components/
    ConfigPanel.tsx      renders itself from a format's config
    PreviewPanel.tsx     deck | video | image
    DeckEditor.tsx, SlideView.tsx
                         the editable carousel/slideshow deck
    UploadField.tsx, MultiUploadField.tsx
                         signed-URL upload straight to Convex storage
    VoicePreview.tsx     the Preview button beside a voice select
    AvatarField.tsx, NewInfluencerModal.tsx, InfluencerRoster.tsx
    TrendingClipField.tsx, AudioClipField.tsx
    PostComposer.tsx     scheduling and posting through Zernio
    AuthStatus.tsx       sign-in state + the owner bootstrap
  hooks/useSupabaseAuth.ts   the ConvexProviderWithAuth contract, for Supabase
  lib/
    estimate.ts          pipeline-driven cost estimate
    supabaseClient.ts    one browser client, shared
  carousel-templates/    the CSS the render service typesets decks with
  proxy.ts               Next 16's middleware: redirects signed-out visitors
../render-service/       sibling repo, deploys separately to Railway
```

## Development

```bash
npm run dev      # the app
npx convex dev   # the backend, in a second terminal
npx tsc --noEmit # typecheck
npm run lint     # eslint
```

## Decisions worth not re-litigating

**Step conditions are data, not predicates.** `when: { field: "script", is:
"empty" }` rather than `when: (c) => !c.script`. A closure can't cross the
server/client boundary — this was a real 500 before it was a design choice —
and declarative conditions let the Convex workflow evaluate a pipeline without
importing the registry.

**`preview` is a union, not a constant.** Carousel outputs stills, Product
Spokesperson stops on one for approval. Writing the editor against a video
player and special-casing the rest later is the mistake Phase 0 exists to
prevent.

**Supabase Auth via Convex's generic `customJwt`, not a bespoke integration.**
Convex ships dedicated packages for Clerk and Auth0, but the underlying
mechanism — verify a JWT against an issuer's JWKS, read
`ctx.auth.getUserIdentity()` — is provider-agnostic. `ConvexProviderWithAuth`
plus one `useSupabaseAuth` hook implementing `{isLoading, isAuthenticated,
fetchAccessToken}` is the entire client-side integration.

**Convex without auth still gets a client; auth without Convex still gets a
sign-in page.** Both `ConvexClientProvider` and `proxy.ts` check their own env
vars independently and degrade rather than crash — gating either on both
services being present took the whole app down the moment one arrived before
the other, which is a real bug this session found and fixed.

**Reasoning happens in text, before pixels.** Image models draw the most
generic reading of each noun, so anything whose scene is built from a topic
goes through `lib/grounding.ts` first. Steps that already have a language
model get the same rules appended to their system prompt.

**Refuse rather than accept the unverifiable.** The render service 401s
without its key; the Zernio webhook rejects events when its secret is unset;
the spend cap stops a run rather than warning about it.

## Known gaps

- The trending-clip download parser (`convex/lib/clipIngest.ts`) is built from
  ScrapeCreators' documented field names, not an observed response — this
  project has never had a `SCRAPECREATORS_API_KEY`. Re-check it against a real
  payload on the first ingestion, including whether `duration` is milliseconds.
- Clip ingestion is a single-URL CLI call; there is no browse-or-search
  surface for finding trends.
- Render output still round-trips through Convex actions as base64. Decoding
  moved into `lib/nodeStorage.ts` (which has the memory headroom for it), but
  the render service should eventually take a signed URL and fetch bytes
  itself.
- The clip, audio and gallery libraries have no admin UI; curation is CLI-only.
- No production deploy yet (Vercel, Railway, a promoted Convex deployment) —
  deliberately last, per the "deployment at the end" call.
