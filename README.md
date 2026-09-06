# Format Engine

Sixteen content formats behind one picker. The successor to `../app`, built on
Convex + Vercel + Railway + fal.ai. See the implementation plan for the why:
https://claude.ai/code/artifact/1295e505-faca-4d71-b58e-8093a96e5ced

## What works today (Phase 0, partial)

```bash
npm run dev
```

- **`/`** — dashboard with the picker popup. All sixteen formats, grouped by
  what comes out, with the three that ship in the old app marked `TODAY` and
  the unbuilt ones showing their phase.
- **`/new/carousel`** — the editor: configuration left, preview right. The
  config panel is generated entirely from `src/formats/carousel.ts`; nothing in
  the panel knows what a carousel is.
- The cost estimate is **live and real** — it walks the format's declared
  pipeline, skips steps whose conditions don't hold, and prices each primitive
  at published fal rates.

Generate is disabled until Convex is connected. Everything above runs with no
accounts and no keys.

## Setup — the parts only you can do

**Do not paste keys into a chat.** Everything below you run yourself; the
values live in files and in Convex's own env store.

### 1. Convex

```bash
cd format-engine && npx convex dev
```

Opens a browser to log in, provisions the deployment, generates
`convex/_generated/`, and writes `CONVEX_DEPLOYMENT` and
`NEXT_PUBLIC_CONVEX_URL` into `.env.local` for you. Leave it running — it
watches and pushes.

If you would rather not log in interactively, put a deploy key in `.env.local`
as `CONVEX_DEPLOY_KEY=...` and use `npx convex dev --once` instead.

### 2. Clerk

Copy `.env.local.example` to `.env.local` and fill in the two keys from your
Clerk application's **API Keys** page:

```
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_...
CLERK_SECRET_KEY=sk_...
```

Then in Clerk, create a **JWT template named `convex`**, copy its Issuer URL,
and give it to the Convex deployment:

```bash
npx convex env set CLERK_JWT_ISSUER_DOMAIN https://<your-app>.clerk.accounts.dev
```

### 3. Server-side keys on Convex

These never go in `.env.local` — they belong to the deployment:

```bash
npx convex env set FAL_API_KEY <your existing fal key from ../app/.env>
npx convex env set RENDER_SERVICE_URL http://localhost:4000
```

### 4. Render service

```bash
cd render-service && npm start
```

Needs Chrome or Edge installed; set `CHROME_BIN` if it can't find one.
Deploys to Railway unchanged.

### 5. Admit yourself

Sign in once, then run `clients:bootstrapFirstClient` from the Convex
dashboard. It only ever creates a row when the table is empty — that is the
owner bootstrap. Every client after that is added deliberately.

## Layout

```
convex/
  schema.ts              clients, brands, avatars, assets, jobs,
                         spend_ledger, clips
  lib/carouselPrompt.ts  the tuned prompt, ported unchanged — three eval
                         rounds went into these numbers
src/
  formats/
    types.ts             defineFormat, the ten primitives, step conditions
    fields.ts            the thirteen recurring field types
    carousel.ts          Phase 0, the whole format
    planned.ts           the other fifteen, declarations only
    index.ts             the registry — the single source of truth
  components/
    FormatPicker.tsx     the popup
    ConfigPanel.tsx      renders itself from a format's config
    PreviewPanel.tsx     deck | video | image
  lib/estimate.ts        pipeline-driven cost estimate
public/carousel-templates/   ported from ../app, unchanged
```

## Two decisions worth not re-litigating

**Step conditions are data, not predicates.** `when: { field: "script", is:
"empty" }` rather than `when: (c) => !c.script`. A closure can't cross the
server/client boundary — this was a real 500 before it was a design choice —
and declarative conditions let the Convex workflow evaluate a pipeline without
importing the registry.

**`preview` is a union, not a constant.** Carousel outputs stills, Product
Spokesperson stops on one for approval. Writing the editor against a video
player and special-casing the rest later is the mistake Phase 0 exists to
prevent.

## Next

1. `npx convex dev`, then wire the job list and the Generate button.
2. Port `../app/worker/export_carousel.mjs` as the first Railway endpoint.
3. Ledger writes on step completion + the per-client monthly cap.
