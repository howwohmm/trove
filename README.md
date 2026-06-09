# trove

a personal taste engine. swipe through images — what you keep trains a
recommendation system that learns your eye, fetches more of what you love,
and dreams up new images in your taste.

not a product. no accounts, no cloud, no tracking. local-first, OSS.

> **v2.** rebuilt from scratch on the learnings of v1's post-mortem and the
> published engineering of Pinterest (Smart Feed, PinnerSage, Pixie) and Meta
> (value models, graded negative signals). the full research-backed spec is
> [`specs/v2-plan.md`](specs/v2-plan.md).

## surfaces

- **swipe** (`/`) — full-bleed gesture deck. right = keep, left = skip. dwell
  time is a signal too (a fast skip means more than a slow one). facet chips
  filter the deck to one taste cluster.
- **library** (`/library`) — pinterest-grade masonry of everything you kept.
  type a vibe in the search bar → your keeps ranked by CLIP text-image cosine.
- **taste** (`/taste`) — your taste, externalized: facets clustered from your
  keeps, each anchored by a real image (the cluster's medoid).
- **dreams** (`/dreams`) — AI images generated in your taste, grounded in your
  actual kept images. kept dreams never pollute retrieval taste.
- **status** (`/status`) — keeps, keep-rate, pool depths, served mix vs target,
  api rate remaining, recent errors. nothing fails silently.

## how it learns (the research-backed parts)

**you are never one vector** *(PinnerSage)*. kept-image CLIP embeddings are
Ward-clustered into facets; each facet is represented by its **medoid** (a real
image) with time-decayed importance `Σ e^(−0.01·days)`. facet ids stay stable
across reclusters (centroid matching).

**candidates wait in pools** *(Pinterest Smart Feed)*. a background refill
fetches per-facet keyword searches (exploit), secondary-keyword searches
(adjacent) and editorial randoms (explore), scores everything **at insert
time**, and persists every fetched candidate to a growing local corpus — the
rankable pool grows even when the api rate limit is exhausted.

**the deck is a value model** *(Meta)*:
`score = 0.55·maxFacetCos + 0.25·sessionCos + 0.20·multiHit − 0.5·antiTaste + ε·uncertainty`
— multi-hit is Pixie's boost for images resonating with *several* recent keeps;
anti-taste is a decaying (14d half-life) vector of your skips, fast-skips
weighted 2.5×; uncertainty boosts regions you've never judged.

**deck assembly fights the filter bubble**: MMR diversity + near-dup cull,
escalating penalty for consecutive same-facet cards, and a proportional
controller holding the served mix near 60/25/15 exploit/adjacent/explore with a
hard exploration floor.

**the frontend is why it feels smooth** *(Pinterest PWA/Gestalt)*: masonry laid
out synchronously from known aspect ratios (absolute positioning, zero CLS),
windowed rendering, dominant-color + blur placeholders; the swipe deck drives
rotation/opacity through MotionValues (zero react re-renders mid-gesture),
decodes the next 3 images ahead, mounts ≤3 cards, and persists optimistically.

## storage

one sqlite db (`node:sqlite`, WAL), every swipe a transaction, backup on boot.
no JSON stores. v1 lost data to concurrent json writes; v2's race test fires 50
concurrent swipes and demands 50 rows.

## run it

```bash
npm install
npm run dev          # http://localhost:3000
npm test             # 29 tests: race, clustering, scoring, feed
npm run import-v1    # one-time migration from a v1 data dir
```

### keys (`.env.local`, gitignored — all optional)

```bash
UNSPLASH_ACCESS_KEY=...   # image source (without it: picsum fallback)
ANTHROPIC_API_KEY=...     # dream prompts (one merged haiku call per dream)
OPENROUTER_API_KEY=...    # dream image generation
OPENROUTER_IMAGE_MODEL=google/gemini-2.5-flash-image
```

## stack

next.js 16 · typescript · node:sqlite · @huggingface/transformers (CLIP
in-process, no GPU) · motion · sharp. eight direct dependencies.

## data (gitignored, local-only)

`data/trove2.db` (+ `.bak` from boot backup) · `/library` (kept files) ·
`/generated` (dreams) · `/.models` (CLIP weights, ~90MB on first run)
