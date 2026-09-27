# Format Engine

Twenty-five content formats behind one picker: decks, slideshows, hook + demo
ads, green-screen memes, talking avatars, generated stop-motion and
documentary scenes, short drama episodes, character swaps. The successor to `../app`, built on Convex +
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

All 25 are declared `ready` in the registry (`src/formats/index.ts`). Each has
its own Convex pipeline file under `convex/`.

| Group | Formats |
| --- | --- |
| Decks | Carousel, Image Slideshow |
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
- **Image Slideshow** is the TikTok / Instagram photo carousel with text on
  every slide. Three settings: *Mention your business*, *Images* (a popup:
  choose one of 51 stock image sets -- Gym, Sunsets, Work/Career... -- or
  upload your own, up to 20) and the *Prompt*, whose Improve button rewrites
  it into a sharper brief. The run writes the slides (P1) in the text style
  the set calls for (`convex/lib/imageSets.ts` maps each set to one of the
  styles in `convex/lib/imageSlideshowTemplates.ts`) and matches one of the
  set's photos to each slide from what the photo shows -- no image
  generation, so a run costs about a cent. It then pauses in an editor on the
  job page: dimensions (1:1, 4:5, 3:4, 9:16), text boxes you drag, resize,
  double-click to type in and style (font, weight, size, color, stroke,
  background none / white / Snapchat / color, with *Apply to all slides*,
  which gives every slide this slide's text style box by box), swap image
  (one slide, or *Use on every slide* to re-theme the whole deck from another
  set, restyling the text to match), add images, add overlay (built-in tints
  and grain, or your own image -- moved, resized and rotated on the slide,
  with opacity, or stretched to fill it), add / reorder / delete slides; a Generate tab draws a new
  photo when nothing fits ($0.08). Save exports every slide as a 1080-wide
  JPEG through the render service's `/render/image-pages` route; preview and
  export share `convex/lib/imageSlideshowDesign.ts`. The image sets are
  empty until seeded -- see *Image sets* under Setup.
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
- **The studio.** Wall of Text's studio (`src/components/wall/WallStudio.tsx`
  over `WallStage.tsx`) is also the editor for three other formats. Their runs
  stop at a `style` gate (a P8 step with `gate: true`), the job page opens the
  studio on the real footage, and **Save** approves the gate with the design.
  The design is the main text plus up to four extra **text boxes** (`boxes`).
  Each is dragged, resized, nudged, undone and styled on its own, and Delete
  removes one. The design is saved as fractions of a 1080x1920 frame and
  checked by `sanitizeDesign` in `convex/lib/wallOfTextDesign.ts` before
  anything renders. `wallLayerHtml` in the same file builds the text layer the
  render service screenshots, so the video matches the editor. Finished jobs
  reopen the studio with **Edit captions again** or **Edit meme again**.
- **Video Hook & Demo** puts a ~4s hook in front of the client's demo video.
  The hook comes from the hook popup (`src/components/HookField.tsx`):
  - **My hooks**: hooks this client already made, reused for free. These are
    ordinary video assets with `hookKind` set (`convex/hooks.ts`).
  - **My videos**: any video of theirs, or a new upload.
  - **Anyone**, **Influencers** or **Pre-made**: a person the run films
    reacting (qwen edit still + Kling clip).

  The other settings:
  - **Demo video**: a gallery-or-upload popup (`DemoVideoField.tsx`).
  - **Background music**: optional.
  - **Add captions**: with it on, a **Captions** box with **Improvise**
    rewrites the line into a 10-12 word hook, or writes one from the business
    when left blank.

  The run stops in the studio once the hook exists. `convex/lib/hookCaption.ts`
  burns the approved caption onto the hook alone through `/render/wall-of-text`,
  and `/render/video-hook-demo` then joins it onto the uncaptioned demo.
- **Speaking Hook & Demo** is the same shape with a speaker: someone says a
  line to camera, then the demo plays. It uses the same hook popup, where a
  reused hook keeps its words. A new speaker has these settings:
  - **Language**: 30-odd eleven-v3 languages (`convex/lib/voiceLanguages.ts`).
    The line is written in the language it will be spoken in.
  - **What they say**: 10-12 words, written from the business if left blank.
  - **How they say it**: a delivery (Shocked, Deadpan, Smug…) that shapes the
    words, eleven-v3's delivery tags and the performance.

  The TTS voice follows the speaker's gender (`convex/lib/roster.ts`). The
  caption is Video Hook's: blank means what they say, styled in the studio.
  Jobs from before the studio keep their old Subtitle style burn-in.
- **Green Screen Meme** puts a meme over the client's own photo or video,
  with a hook caption on top. Its settings:
  - **Upload image or video**: a popup with their photo and video gallery,
    or a new upload (`src/components/meme/BackgroundField.tsx`).
  - **Choose meme**: a popup (`src/components/meme/MemeField.tsx`) with
    KLIPY's five libraries in their own tabs (GIFs, Clips, Stickers, Memes,
    AI Emojis), then **My memes** and **Upload new**. The KLIPY side has
    search with autocomplete, related searches, categories, Recently used, a
    "green screen" shortcut and Report.
  - **Add captions**: a switch, on by default, as in Video Hook & Demo. Off
    hides the Hook caption box, and the studio opens with no caption.
  - **Hook caption**: a 5-14 word line whose **Improvise** reads the meme's
    title, and which is written from the meme when left blank.
  - **Mention your business**.

  A live preview on the right composes the picks. The run stops in the
  **meme studio** (`src/components/wall/MemeStudio.tsx` +
  `MemeInspector.tsx`), where the meme is a layer:
  - drag it, resize it from the corner, and flip it
  - key out its green screen, previewed live by an SVG filter
  - choose whose sound plays: the meme's, the background video's, or none
  - over a photo, set the length (3-20s)

  The caption and text boxes are styled in the same studio. The design is
  `WallDesign & {meme}` (`convex/lib/memeDesign.ts`). The render sends the text
  layer HTML, the background URL, the meme URL and the meme placement to
  `/render/green-screen-meme`, where ffmpeg keys, scales and overlays the meme
  under the text. A job whose render fails offers **Render again** (the saved
  design, no editor) and **Edit meme again**. Jobs made before the studio
  (they planned a `clip` step: a trending clip keyed over a still) still run
  the old way at the bottom of `convex/greenScreenMeme.ts`.
- **KLIPY's rules**, and where the app follows them (`src/lib/klipy.ts`):
  - Every KLIPY request is made from the browser, with a
    `NEXT_PUBLIC_KLIPY_APP_KEY`.
  - Media URLs are used exactly as returned and never stored or re-hosted.
    `parseMemePick` accepts only `https://static*.klipy.com/` URLs.
  - Results keep KLIPY's order, each library in its own tab.
  - The search box reads "Search KLIPY", and "Powered by KLIPY" is shown.
  - Every pick fires the Share Trigger with an anonymous customer id: a
    SHA-256 hash of the client id.
  - KLIPY may place ad tiles in results; they are shown as ads (`AdTile`).
    Ads are switched on or off per key in KLIPY's Partner Panel, not in code.
  - The render service fetches the picked meme server-side to burn it into
    the video, which KLIPY only allows with their written approval. See
    *Known gaps*.
- **The business profile** is collected by a quiz every new client is sent
  to once after sign-up (`/onboarding`): name and logo (brand colors are read
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
- The rest of the production extras — music, upscale, captions, branding — come
  from `convex/lib/extras.ts`, and the voiceover is always on for those two
  formats (it is what they are cut to), so it has no switch. Captions (the setting was called Subtitles before) — the
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

Without it the tab says it isn't switched on, and uploads still work. The
free key is for non-commercial use: production needs a commercial license
from Freesound first (*Deployment checklist*, step 0). A
picked track is copied into `audioTemplates` once (`convex/music.ts`), so a
job keeps its music even if the track later leaves Freesound.

### KLIPY (for Green Screen Meme's meme popup)

Create an app key at https://partner.klipy.com (API Keys) and put it in
`.env.local`. It is public by design, because KLIPY requires calls from the
browser:

```
NEXT_PUBLIC_KLIPY_APP_KEY=<your key>
```

Restart `npm run dev` after adding it. Without a key, the popup's KLIPY side
explains how to set one up, and My memes and Upload new still work. A new key
is in **Testing** mode, capped at 100 requests an hour. Request **Production**
in the Partner Panel before launch. KLIPY is free (it is funded by ads), and
ads are turned on or off per key in that same panel. `next.config.ts` already
allows `api.klipy.com` and `*.klipy.com` media in the CSP.

### Image sets (for Image Slideshow)

The 51 stock photo sets are downloaded once into Convex storage from Pexels
and Pixabay (both free; Pixabay forbids hotlinking, so the bytes are kept).
Get a key from [pexels.com/api](https://www.pexels.com/api/) and
[pixabay.com/api/docs](https://pixabay.com/api/docs/), then:

```bash
npx convex env set PEXELS_API_KEY <key>
npx convex env set PIXABAY_API_KEY <key>
npx convex run imageSets:seed          # ~10 per source per set, about 2 minutes
npx convex run imageSets:status        # photos per set
```

Seeding again only tops sets up to 20. Hide a photo that doesn't fit with
`npx convex run imageSets:archive '{"imageId":"…"}'`. Search terms and the
popup's categories live in `convex/lib/imageSets.ts`. Uploading your own
images works without any of this. Sets seeded before thumbnails existed get
them with `npx convex run imageSets:backfillThumbs`.

The popup also searches both sources live. What their API terms require, and
where the app does it:

- **Attribution** -- "Photos provided by Pexels and Pixabay" with links under
  every grid, "from Pexels & Pixabay" on search results, and "Photo by
  *name* on *source*" linking to each photo's page on hover.
- **No hotlinking** -- a photo is downloaded into Convex storage before it is
  used; the sources' URLs are only shown as search thumbnails.
- **24-hour search cache** -- `stockSearches`, pruned daily by `crons.ts`.
- **Quotas** -- a deployment-wide budget under each limit (Pexels 200/hour
  and 20,000/month, Pixabay 100/minute), in `convex/lib/rateLimit.ts`. When
  one source is out of budget, search uses the other.
- **No mass downloading** -- 20 photos per set at most; searched photos are
  stored only when picked.

The licenses allow commercial use without credit in the posts themselves, but
not selling a photo unaltered or implying that people or brands shown endorse
you; the popup says so.

**Keeping the running cost down:**

- The run matches stock or uploaded photos instead of generating them, and
  the popup's grids load ~25 KB thumbnails rather than ~130 KB photos.
- Improve runs on Claude Haiku 4.5 (about $0.002 a click); the slide writer
  stays on the app's main model.
- The editor's Generate tab (the only paid image action, $0.08) is capped at
  20 per client per day (`GENERATED_IMAGES_PER_DAY`).
- `retention.ts` runs daily: exported slides older than 90 days are deleted
  (the deck is kept, so "Edit slides again" re-exports them free, and the job
  page says so), as are photos picked from the photo search that nothing has
  used in 90 days. Anything a draft, scheduled or publishing post, brand
  profile, avatar or influencer points at is kept. Preview a run with
  `npx convex run retention:run '{"dryRun":true}'` (add `"olderThanDays":0`
  to see what would go if everything were old enough).
- The render service keeps one Chrome warm between renders -- see its README.

### 4. Render service

```bash
cd ../render-service
npm install
RENDER_SERVICE_API_KEY=<the same string> npm start
```

Needs Chrome/Edge and ffmpeg; set `CHROME_BIN` / `FFMPEG_BIN` if either isn't
found automatically. **Restart it whenever this repo's Slideshow or Video Animation change:** they send a `voiceoverUrl` that an older service would silently ignore, leaving the video with no voice. So both formats check `/health` (which reports `voiceover: true` from current code) before spending anything, and stop with a message telling you to restart it. Green Screen Meme is the same: a service from before the meme studio renders only the old keyed clip, so the render step detects that and fails with "The render service is running old code that can't place a meme". Restart the service, then use **Render again** on the job page. To try a render-service change without disturbing the running one, start a second copy on a spare port (`PORT=4411 npm start`) and point a curl at it. It serves the routes the formats call: `/render/carousel`,
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

## Deployment checklist

Deployment is deliberately the last step. Until then everything runs on the
anonymous local Convex backend, which has **no separate production
deployment** -- `--prod` on it silently means the local one. Work through this
in order when the repo is ready to host.

**0. Approvals and decisions -- before anything goes live**

Nothing below needs code; each one needs a person. Don't deploy for real users
while any box here is open. Agents are told to stop and remind you of this list
before any deployment step (AGENTS.md, *Before deploying*).

- [ ] **KLIPY -- written confirmation for server-side use.** Email
      developers@klipy.com and get their OK, *in writing*, for the render
      service fetching a picked meme server-side to burn it into a video.
      KLIPY's terms only cover showing their media in the browser. Until the
      confirmation arrives, KLIPY memes are preview-only (*KLIPY memes (render
      gate)* above). Once it's in hand, keep a copy with the project records
      and run `npx convex env set --prod KLIPY_SERVER_RENDER_APPROVED true`.
      Separately, request **Production access** for the KLIPY key in the
      Partner Panel (Testing is 100 requests an hour for every user).
- [ ] **Freesound -- a commercial license for the API.** The Freesound API is
      free for non-commercial use only; commercial use is negotiated case by
      case with UPF (Freesound's owner) through Freesound's contact page. The
      Platform music tab searches Freesound and copies tracks into clients'
      videos, which is commercial use. Until a license is agreed, either leave
      `FREESOUND_API_KEY` unset on production (the tab then says it isn't
      switched on; uploads and generated music still work) or get the license
      first. The tracks themselves are CC0, so the sound licenses are fine.
      Planned instead: replace Freesound with a CassetteAI house library
      (*Pending tasks* below), which makes this license unnecessary.
- [ ] **Privacy policy and terms of service.** Publish both before real users
      sign up. The privacy policy has to name every processor that receives
      users' data: fal.ai (image, video, voice and the LLM -- including the
      photos people upload), Zernio (posting), Supabase (sign-in), Convex
      (database and storage), Railway (render service), Vercel (the app), and
      KLIPY, Pexels, Pixabay and Freesound (searches). Needed for GDPR, CCPA and
      the platforms' own developer terms.
- [ ] **Legal review of the AI disclosure and consent wording.** The app
      implements New York's synthetic performer law (GBL § 396-b), the EU AI
      Act art. 50, the FTC's endorsement and fake-review rules (16 CFR 255 and
      465), COPPA and likeness consent (*AI disclosure and likeness consent*
      above) -- but none of it has been reviewed by a lawyer. Have counsel check
      the caption disclosure line, the consent checkbox texts and the
      fake-review rule before launch.
- [ ] **Decide on trending-clip scraping.** Ingesting TikToks through
      ScrapeCreators is against TikTok's terms, whatever rights a client
      confirms for a clip. Either drop it (leave `SCRAPECREATORS_API_KEY` unset
      on production -- nothing else depends on it) or move to licensed clips.
- [ ] **TikTok and Instagram accounts through Zernio.** The app side is done:
      *Connections* connects Instagram with Facebook Login by default
      (`loginMethod=facebook_login`), and TikTok through Zernio's TikTok for
      Business app, the lane every new connection gets. That lane direct-posts
      videos as public only; other levels go out only as a draft to the TikTok
      app. Still to do, by hand: reconnect @inside.f12 with *Connect with
      Facebook* (it's on Instagram Login, which can't set *Paid
      partnership*; the account must be linked to a Facebook Page you manage),
      connect the TikTok account, and on production set `ZERNIO_API_KEY` and
      `ZERNIO_WEBHOOK_SECRET` with `--prod`.
- [ ] **Render service on Railway is current.** Before pointing production at
      it: `curl https://<railway-url>/health` shows `"aiLabel":true` and
      `"browserWarm"` (the label route and the meme studio). Without the label
      route, scheduling a video post stops with a "redeploy the render
      service" message.

Pending tasks -- build work to finish before launch (the same reminder rule
applies):

- [ ] **Replace Freesound with a CassetteAI house library.** Generate about 50
      instrumental tracks once with `cassetteai/music-generator` on fal
      (active, licensed for commercial use, $0.02 per minute -- about $1-2 for
      the whole set), across moods such as upbeat, chill, dramatic, corporate,
      lo-fi and cinematic, and store them as `audioTemplates` so the audio
      popup's **Platform** tab browses them instead of Freesound. Then remove
      the Freesound search (`convex/music.ts`) and `FREESOUND_API_KEY`. That
      also closes the Freesound license item above. Optional later: a
      "describe the mood" Generate button, charged against the spend cap.
- [ ] **Move Drama's score off `fal-ai/elevenlabs/music` before December 17,
      2026**, when fal retires that endpoint. The replacements,
      `fal-ai/elevenlabs/music/v2` and `v2.5`, take the same inputs Drama sends
      (`prompt`, `music_length_ms`, `force_instrumental`), but on 2026-09-26
      fal still listed them as private previews, with no commercial license
      and no published price. Switch to `v2.5` once
      `https://api.fal.ai/v1/models?endpoint_id=fal-ai/elevenlabs/music/v2.5`
      shows `"license_type": "commercial"` and a price: change `MUSIC_MODEL`
      and `MUSIC_PER_MINUTE` in `convex/drama.ts` and `musicPerMinute` in
      `src/lib/estimate.ts`. If it isn't published by early December, move
      Drama to CassetteAI instead (as Slideshow uses it; it accepts 10-180 s,
      so loop or trim the bed like `convex/lib/extras.ts` does).

**1. Convex -- a hosted production deployment**

- [ ] `npx convex login`, link this repo to a Convex cloud project, and
      `npx convex deploy` to create production. Its URL is
      `https://<name>.convex.cloud`, which the CSP in `next.config.ts` already
      allows.
- [ ] Set every server-side variable on production. Nothing carries over from
      the local backend:

      | Variable | Value |
      | --- | --- |
      | `FAL_API_KEY` | your fal key |
      | `RENDER_SERVICE_URL` | the Railway URL from step 2 -- **not** `http://localhost:4000` |
      | `RENDER_SERVICE_API_KEY` | the same long random string Railway is given |
      | `SUPABASE_JWT_ISSUER`, `SUPABASE_JWKS_URL` | as in Setup §2 |
      | `FREESOUND_API_KEY` | the key from your Freesound app page (Platform music) |
      | `ZERNIO_API_KEY`, `ZERNIO_WEBHOOK_SECRET` | posting, calendar, analytics |
      | `SCRAPECREATORS_API_KEY` | optional: trending-clip ingestion |

      Each one: `npx convex env set --prod <NAME> <value>`.
- [ ] Re-seed the shared libraries on production -- the local database doesn't
      move. **Gallery faces need their labels again**
      (`npx convex run --prod galleryFaces:label '{"faceId":…,"gender":…,"label":…}'`),
      or "A woman" / "A man" casting has nothing to draw from. Add any house
      audio tracks the same way they were added locally.

**2. Render service -- Railway**

- [ ] Deploy `format-engine-render-service` `master`. It must include:
      - the Wall of Text `layerHtml` renderer, without which every Wall of
        Text render and every hook caption fails
      - Image Slideshow's `/render/image-pages` route, without which every
        slideshow export fails
      - `/render/green-screen-meme`'s `layerHtml` + `memeUrl` path, without
        which every Green Screen Meme render fails with the "old code" message
- [ ] Set `RENDER_SERVICE_API_KEY` to the same value as Convex's.
- [ ] `curl https://<railway-url>/health` returns `"ok":true` and `"voiceover":true`.

**3. App -- Vercel**

- [ ] `NEXT_PUBLIC_CONVEX_URL` (production), `NEXT_PUBLIC_SUPABASE_URL`,
      `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `NEXT_PUBLIC_KLIPY_APP_KEY`
      (a Production-access key).
- [ ] Build with `npx convex deploy --cmd 'npm run build'` and a
      `CONVEX_DEPLOY_KEY`, so the functions and the site ship together.

**4. Outside services**

- [ ] Supabase: add `https://<your-domain>/auth/callback` to the redirect-URL
      allow-list and set the Site URL -- confirmation and reset emails land there.
- [ ] Zernio: point its webhook at `https://<name>.convex.site/zernio/events`.
      (fal's training webhook needs nothing -- it's built from `CONVEX_SITE_URL`.)
- [ ] Freesound: optionally update the app's URL to the production domain.
- [ ] KLIPY: ads set the way you want them in the Partner Panel. The written
      confirmation and Production access are in step 0.

**5. First run on production**

- [ ] Sign up, confirm, and check `clients:bootstrapFirstClient` admitted you.
- [ ] The business quiz appears once, and the website analysis works.
- [ ] Music popup: a Platform search returns tracks and a preview plays.
- [ ] Wall of Text end to end: film a cast person (~$0.55), style it in the
      studio, Save, then Schedule.
- [ ] Seed the image sets on production (`npx convex run --prod imageSets:seed`,
      after setting both keys with `--prod`).
- [ ] Image Slideshow end to end (about a cent): pick an image set, Improve a
      prompt, generate, edit in the editor, Save, then Schedule.
- [ ] Green Screen Meme end to end (under a cent with a typed caption): upload
      a photo, pick a KLIPY GIF, place and key it in the meme studio, Save.
- [ ] Video Hook & Demo with a hook from My videos (free): type a caption,
      style it in the studio, Save.

## Layout

```
convex/
  schema.ts              clients, brands, avatars, assets, jobs, spend_ledger,
                         influencers, galleryFaces, houseImages, stockImages,
                         stockSearches, audioTemplates, clips, socialAccounts,
                         socialPosts, postAnalytics, zernioWebhookEvents
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
  assets.ts, uploads.ts  the media bank: gallery queries (mediaLibrary,
                         memeLibrary, mediaInfo) and signed-URL uploads
  hooks.ts               My hooks: hook clips a client made, offered again
  onboarding.ts, brands.ts
                         the business quiz and the profile it writes
  music.ts               Freesound search + copying a picked track in
  imageSets.ts           Image Slideshow's stock sets and live photo search
  retention.ts           the daily clean-up of old exports and unused photos
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
  lib/extras.ts          music, upscale, captions, branding
  lib/scriptTiming.ts    script -> scene count (X / 3) and the words in each scene
  lib/scriptVoice.ts     writes a script from an idea; records it with word timings
  lib/carouselPrompt.ts  the tuned prompt, ported unchanged — three eval rounds
                         went into these numbers
  lib/renderService.ts   base URL + auth headers for every render-service call
  lib/wallOfTextDesign.ts
                         the studio's design: sanitizeDesign, wallLayerHtml
                         (the text layer the render service screenshots),
                         text boxes, and the meme layer's type
  lib/hookCaption.ts     burns a studio design onto a hook clip (both hook + demo
                         formats)
  lib/memeDesign.ts      Green Screen Meme: MemePick, parseMemePick (KLIPY URL
                         allow-list), default placement, sanitizeMemeDesign
  lib/voiceLanguages.ts  the languages a spoken line can be written and voiced in
  lib/businessContext.ts every "Mention your business" toggle's prompt text
  lib/imageSets.ts, lib/imageSlideshowDesign.ts, lib/imageSlideshowTemplates.ts
                         Image Slideshow's sets, editor/export design and styles
  lib/nodeStorage.ts     the one "use node" place that decodes and stores
                         render output
  dev.ts                 CLI-only seeding/inspection
src/
  formats/
    types.ts             defineFormat, the ten primitives, step conditions
    fields.ts            the recurring field types
    carousel.ts, slideshow.ts, imageSlideshow.ts, wallOfText.ts,
    videoAnimation.ts, drama.ts, extras.ts
                         the formats with a file of their own
    planned.ts           the rest, incl. both hook + demo formats and Green
                         Screen Meme (the name predates them being built)
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
    HookField.tsx        the hook popup (My hooks, My videos, Anyone,
                         Influencers, Pre-made) for both hook + demo formats
    DemoVideoField.tsx, VideoLibrary.tsx
                         the demo video popup and the shared video gallery
    wall/                the studio: WallStudio + WallStage (Wall of Text),
                         HookCaptionStudio (hook + demo captions), MemeStudio +
                         MemeInspector (Green Screen Meme)
    meme/                Green Screen Meme's config: BackgroundField,
                         MemeField (the KLIPY popup), MemePreview, and the
                         shared PickerDialog / useMediaUpload
    slideshow/           Image Slideshow's set picker and slide editor
    business/            the onboarding quiz and the Business page
    PostComposer.tsx     scheduling and posting through Zernio
    AuthStatus.tsx       sign-in state + the owner bootstrap
  hooks/useSupabaseAuth.ts   the ConvexProviderWithAuth contract, for Supabase
  lib/
    estimate.ts          pipeline-driven cost estimate
    klipy.ts             the KLIPY client (browser-only): lists, search,
                         autocomplete, recent, share trigger, report
    supabaseClient.ts    one browser client, shared
  carousel-templates/    the CSS the render service typesets decks with
  app/jobs/[jobId]/JobView.tsx
                         the job page: progress, gates, which studio a
                         gate opens (STUDIO_STEP), Edit … again / Render again
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

## AI disclosure and likeness consent

Every video here is AI-made, and many show a person who doesn't exist. These
are the rules that apply, and the code that follows each. Keep them when
touching posting, the casting popup, influencers or Character Swap.

- **Platform AI labels.** TikTok's AIGC policy, YouTube's altered/synthetic
  content policy and Meta's AI labels. The composer sets TikTok's
  `video_made_with_ai`, YouTube's `containsSyntheticMedia` and Instagram's
  `isAiGenerated`, all on by default (`src/components/PostComposer.tsx`).
  Zernio reads settings only on each `platforms[]` entry, and TikTok's under
  `tiktokSettings` (`zernioPlatformData` in `convex/lib/zernio.ts`); a
  root-level `platformSpecificData` is silently ignored, which dropped these
  labels and TikTok's consent flags on every post before the fix.
- **TikTok commercial content disclosure.** TikTok requires it on any post
  promoting a business, including the creator's own. The composer offers
  *Your brand* / *Branded content* (`commercialContentType`), off by default
  as TikTok's guidelines require, blocks branded content set to private, and
  names the Branded Content Policy in the consent line when it applies.
- **New York synthetic performer law (GBL § 396-b, from 9 June 2026) and EU
  AI Act art. 50(4) (from 2 August 2026).** An ad showing an AI-generated
  person must say so, visibly, in the ad. When the posted media came from a
  job that filmed, lip-synced or swapped a person (P3/P5/P6), the caption
  opens with "Made with AI · features an AI-generated person"; the switch
  starts on for those and off otherwise (`convex/lib/disclosure.ts`,
  `socialPosts.disclosure`). Two more switches sit under it:
  - *Burn an "AI-generated" label* (same default): a badge in the top-left
    corner that survives downloads and reposts.
  - *Tag the video file as AI-generated* (on): a metadata tag, which most
    platforms strip.

  Either one makes `socialPosts.schedule` run the media through the render
  service's `POST /label/ai` (`../render-service/label.mjs`) once, save the
  copies as `postedMediaAssetIds`, and post those. The original render is
  left alone. A service without the route (its `/health` lacks
  `aiLabel: true`) stops the schedule with a message to restart it.
- **Likeness consent.** A real person's photo is only animated, lip-synced or
  trained into an influencer with their permission (right of publicity; fal
  and ByteDance usage rules; Seedance rejects real faces outright). The
  client ticks `LikenessConsent` when picking or uploading a photo in My
  images and before training on uploads; it's recorded on the asset as
  `likenessConsentAt`. `run.generate` and `influencers.create` refuse
  unconfirmed photos (`convex/lib/likeness.ts`). Faces the app generated
  (`synthetic: true`) and job outputs are exempt. Character Swap asks per job
  with a required *Permission from the people shown* switch. Gallery faces
  added with `dev:addGalleryFace` need a model release.
- **TikTok Content Sharing Guidelines** (a condition of TikTok's Direct Post
  API). The composer shows the creator's nickname from creator info; who can
  see the post and the comment / duet / stitch switches start unset; an
  interaction the creator switched off in TikTok is greyed out; duet and
  stitch are hidden for photo posts; commercial content options are the ones
  the account offers; and it blocks a post over the account's max video
  length or daily limit. The consent line links TikTok's Music Usage
  Confirmation (and Branded Content Policy when it applies).
- **YouTube audience (COPPA).** "Made for kids?" has no default and must be
  answered before posting to YouTube (`madeForKids`).
- **Paid partnerships (FTC endorsement guides).** Instagram gets a *Paid
  partnership* switch (`isPaidPartnership`, optional `brandedContentSponsors`).
  Instagram only sets it on accounts connected with Facebook Login, so the
  switch is off for any account whose `socialAccounts.loginMethod` isn't
  `facebook_login`, and *Connections* offers Facebook first
  (`convex/social.ts` `startConnect`). When that or TikTok's *Branded content* is on, the
  caption opens with "#ad" unless the user unticks it -- the only disclosure
  YouTube and LinkedIn get here.
- **Trending clips (copyright; TikTok's terms).** The library is other
  creators' videos. Picking one needs *I have the creator's permission, or a
  license*, recorded per client and clip in `clipRights`; `run.generate`
  refuses a job using a clip without it (`convex/clips.ts`). The picker links
  the original post and warns when the clip has music. Ingestion keeps
  TikTok's watermark (the creator's attribution) unless run with
  `keepWatermark: false` for a clip licensed without it
  (`convex/lib/clipIngest.ts`).
- **Third-party AI processing.** The likeness consent box says the photo is
  sent to fal.ai. The app's own privacy policy should name the processors
  too: fal.ai (image, video, voice and the LLM), Zernio (posting), Supabase
  (sign-in), Convex (storage), KLIPY, Pexels, Pixabay and Freesound.
- **KLIPY memes (render gate).** KLIPY's terms have its media shown in the
  browser; rendering a meme into a video means the render service fetching
  it, which needs KLIPY's written OK. Until then the meme popup browses and
  previews KLIPY but can't use a KLIPY meme, and says why; `run.generate`
  refuses a Green Screen Meme job with one, and the render step checks again
  (`convex/lib/klipyTerms.ts`). Uploaded memes always render. Once KLIPY
  approves: `npx convex env set KLIPY_SERVER_RENDER_APPROVED true`.
- **Music.** Platform music comes from Freesound, CC0 only (`music.ts`), and
  generated music from ElevenLabs via fal. The CC0 tracks and ElevenLabs
  output are cleared for commercial use, but the Freesound *API* is
  non-commercial unless licensed -- see *Deployment checklist*, step 0.
- **API keys.** Server keys live only in Convex env (`npx convex env set`);
  `.env.local` holds only `NEXT_PUBLIC_*` values that are public by design
  (Supabase publishable key, KLIPY app key). No key is committed in either
  repo's history.
- **FTC endorsement rules (16 CFR 255, 465).** An AI person may not pose as a
  real customer describing a real experience. The Business page's *Keep
  scripts clear of fake reviews* switch (`brands.testimonialGuard`, on unless
  switched off) adds a rule to every prompt that mentions the business: the
  speaker may react, ask or say what it does, but never claim to have used
  it or what it did for them (`testimonialRule` in
  `convex/lib/businessContext.ts`; Wall of Text builds its own business
  prompt and appends it there).

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
- **Open approvals block launch.** KLIPY's written confirmation, a Freesound
  commercial license, a privacy policy, a legal review and the scraping
  decision are all still open -- see *Deployment checklist*, step 0.
- **Drama's music endpoint retires on December 17, 2026.** Its v2/v2.5
  replacements weren't commercially published on fal yet; the plan and the
  fallback are in step 0's *Pending tasks*.
- **KLIPY server-side fetch is not yet approved: a written confirmation is
  needed.** KLIPY's terms ask for
  browser-only use; burning a meme into a video needs the render service to
  fetch it, which needs KLIPY's written OK (developers@klipy.com). The code
  already keeps to everything else: URLs unaltered, never stored, fetched for
  one render and deleted. Uploaded memes don't involve KLIPY at all. Until
  the OK arrives, KLIPY memes are preview-only: see *KLIPY memes (render
  gate)* above, and set `KLIPY_SERVER_RENDER_APPROVED` once it does.
- A KLIPY key stays in Testing (100 requests an hour, shared by every user)
  until Production access is granted. The popup caches pages and
  de-duplicates in-flight requests to stretch it.
- No production deploy yet (Vercel, Railway, a promoted Convex deployment) —
  deliberately last, per the "deployment at the end" call. Everything it
  involves is in [Deployment checklist](#deployment-checklist).
