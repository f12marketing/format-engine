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

## What I can't do for you

These need your accounts, and each one hands back a key:

| Service | What to do | Where the key goes |
| --- | --- | --- |
| **Convex** | `npx convex dev` — opens a browser to log in, then creates the project | writes `.env.local` itself |
| **Clerk** | Create an app at clerk.com, enable invite-only | `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY` |
| **fal.ai** | Existing key from `../app/.env` works | `FAL_KEY` (Convex env, not `.env.local`) |
| **Railway** | Later — Phase 0's render step can run locally first | — |

Put the Clerk keys in `.env.local`; set `FAL_KEY` with
`npx convex env set FAL_KEY <key>` so it lives server-side only.

> **Note on Clerk + Next 16:** `middleware.ts` is deprecated in favour of
> `proxy.ts` with an exported `proxy` function, and the `edge` runtime isn't
> supported there. Worth checking Clerk's own Next 16 guidance before wiring
> `clerkMiddleware`, rather than copying a Next 15 snippet.

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
