# Format Engine

Sixteen content formats behind one picker. The successor to `../app`, built on
Convex + Vercel + Railway + fal.ai, with Supabase Auth. See the implementation
plan for the why:
https://claude.ai/code/artifact/1295e505-faca-4d71-b58e-8093a96e5ced

## What works today

```bash
npm run dev
```

- **Three formats are live end to end**: Carousel, Wall of Text, Custom.
  Twelve more are declared in the registry and show their build phase in the
  picker; the rest are code, not vapourware — see `src/formats/planned.ts`.
- **`/`** — the dashboard: the picker popup, and the job list once you're
  signed in.
- **`/new/<formatId>`** — configuration left, preview right. The panel is
  generated entirely from the format's declaration; nothing in it knows what
  a carousel or a wall of text is.
- The cost estimate is **live and real** — it walks the format's declared
  pipeline, skips steps whose conditions don't hold, and prices each
  primitive at published fal rates.
- **The render service does real work**: headless-Chrome carousel exports,
  ffmpeg compositing, five caption styles, generated and uploaded
  backgrounds.

The picker, config panels and estimates all work with zero accounts. Signing
in, uploading, and Generate need the setup below.

## Setup — the parts only you can do

**Do not paste keys into a chat.** Everything below you run yourself; the
values live in files and in Convex's own env store. Two of Format Engine's
keys are *meant* to be public (Supabase's publishable key, `NEXT_PUBLIC_*`
Convex URLs) — the rest are not.

### 1. Convex

```bash
cd format-engine && npx convex dev
```

No account needed to start: this provisions an **anonymous local backend**
on `127.0.0.1:3210` and writes `CONVEX_DEPLOYMENT` /
`NEXT_PUBLIC_CONVEX_URL` into `.env.local` itself. Leave it running — it
watches and redeploys on save. Run `npx convex login` later, whenever you
want this promoted to a real hosted deployment.

### 2. Supabase Auth

The frontend needs two **publishable** values in `.env.local` (copy
`.env.local.example`):

```
NEXT_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
```

Convex validates the JWT itself, so it needs the issuer and JWKS URL — set
once on the deployment, never in `.env.local`:

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

**One thing I could not verify without a real inbox:** Supabase's redirect-URL
allow-list (Dashboard → Authentication → URL Configuration). Add
`http://localhost:3000/auth/callback` there, and your eventual production
URL later. The `/auth/callback` route already handles the exchange; this is
the one manual dashboard step behind it.

### 3. Server-side keys on Convex

Never in `.env.local` — these belong to the deployment:

```bash
npx convex env set FAL_API_KEY <your existing fal key from ../app/.env>
npx convex env set RENDER_SERVICE_URL http://localhost:4000
```

### 4. Render service

```bash
cd render-service && npm start
```

Needs Chrome/Edge and ffmpeg; set `CHROME_BIN` / `FFMPEG_BIN` if either
isn't found automatically. `Dockerfile` + `railway.json` are ready for a
Railway deploy — see that repo's own README.

### 5. Admit yourself

Visit `/sign-in`, request a magic link, click it. The dashboard then calls
`clients:bootstrapFirstClient` automatically — it only ever creates a row
when the `clients` table is empty, so this admits exactly the first person
who ever signs in, and does nothing for anyone after. Add further clients
as rows from the Convex dashboard; there's no self-serve signup by design.

## Layout

```
convex/
  schema.ts              clients, brands, avatars, assets, jobs,
                         spend_ledger, clips
  auth.config.ts         Supabase JWT verification (customJwt provider)
  clients.ts             invite-only resolution: JWT subject -> clients row
  ledger.ts              spend tracking + the pre-spend cap assertion
  carousel.ts            Phase 0's pipeline: P1 (LLM) -> P8 (render)
  custom.ts              P7+P8 in one ffmpeg hop, zero model calls
  wallOfText.ts          the format that proves the copy step is optional
  lib/fal.ts             the fal.ai client: forced tool-calls + queue polling
  lib/carouselPrompt.ts  the tuned prompt, ported unchanged — three eval
                         rounds went into these numbers
  dev.ts                 CLI-only seeding/inspection (internal*, unreachable
                         from the browser)
src/
  formats/
    types.ts             defineFormat, the ten primitives, step conditions
    fields.ts            the thirteen recurring field types
    carousel.ts / planned.ts   all sixteen formats declared
    index.ts             the registry — the single source of truth
  components/
    FormatPicker.tsx     the popup
    ConfigPanel.tsx      renders itself from a format's config
    PreviewPanel.tsx     deck | video | image
    UploadField.tsx      signed-URL upload straight to Convex storage
    AuthStatus.tsx        sign-in state + the owner bootstrap
  hooks/useSupabaseAuth.ts   the ConvexProviderWithAuth contract, for Supabase
  lib/
    estimate.ts           pipeline-driven cost estimate
    supabaseClient.ts      one browser client, shared
  proxy.ts                Next 16's middleware: redirects signed-out visitors
render-service/ (sibling repo, deploys separately to Railway)
```

## Decisions worth not re-litigating

**Step conditions are data, not predicates.** `when: { field: "script", is:
"empty" }` rather than `when: (c) => !c.script`. A closure can't cross the
server/client boundary — this was a real 500 before it was a design choice —
and declarative conditions let the Convex workflow evaluate a pipeline
without importing the registry.

**`preview` is a union, not a constant.** Carousel outputs stills, Product
Spokesperson stops on one for approval. Writing the editor against a video
player and special-casing the rest later is the mistake Phase 0 exists to
prevent.

**Supabase Auth via Convex's generic `customJwt`, not a bespoke integration.**
Convex ships dedicated packages for Clerk and Auth0, but the underlying
mechanism — verify a JWT against an issuer's JWKS, read `ctx.auth.getUserIdentity()`
— is provider-agnostic. `ConvexProviderWithAuth` plus one `useSupabaseAuth`
hook implementing `{isLoading, isAuthenticated, fetchAccessToken}` is the
entire client-side integration.

**Convex without auth still gets a client; auth without Convex still gets a
sign-in page.** Both `ConvexClientProvider` and `proxy.ts` check their own
env vars independently and degrade rather than crash — gating either on both
services being present took the whole app down the moment one arrived before
the other, which is a real bug this session found and fixed.

## Known gaps

- Uploaded/rendered files round-trip through Convex actions as base64. Fine
  for images and short clips, wrong for a large demo video — the render
  service should eventually take a signed URL and fetch bytes itself.
- The avatar roster (P10) and clip library (P9) are declared as field types
  but have no backing tables yet — they render as placeholders in the config
  panel until Phases 3–4.
- No production deploy yet (Vercel, Railway, a promoted Convex deployment) —
  deliberately last, per the "deployment at the end" call.
