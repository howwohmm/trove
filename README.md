# trove

a personal, single-user tool for curating tasteful images — and generating new
ones in your own taste. swipe through photos; the ones you keep land on disk,
train a recommendation engine that learns your eye, and seed an AI that dreams up
fresh images that look like *you*.

not a product. no accounts, no cloud, no tracking. local-first, OSS. just you and
your taste.

> **status: day-one prototype.** The rec engine and generation loop work and are
> genuinely good. The JSON persistence layer has known concurrency/atomicity
> issues — see [Known issues](#known-issues). Don't trust it with data you can't
> lose yet.

## what it does

- **swipe** (`/`) — Tinder-style deck. Right = keep (downloads to `/library`,
  trains taste, can seed a dream). Left = skip. Facet chips filter the feed by
  one of your taste clusters.
- **library** (`/library`) — full-bleed Pinterest masonry of everything you kept.
- **dreams** (`/dreams`) — AI images generated in your taste. Swipe them too:
  keep breeds a mutated child (genetic prompt evolution); pass kills the lineage.
- **tune** (`/tune`) — steer generation (a direction + an avoid-list), and
  "dream from a facet" on demand.
- **status** (`/status`) — live dashboard: API rate/credits, taste keeps,
  keep-rate, facets, corpus size, dreams. Refreshes every 8s.

## how the recommendation works

(full design: [`specs/recommendation-engine.html`](specs/recommendation-engine.html))

1. **Embeddings** — every image is embedded with CLIP in-process via
   transformers.js (no GPU, no API).
2. **Facets** — your kept images are k-means clustered into taste facets; Claude
   names each and gives search keywords. Facets = categories = the multi-interest
   model. (Avoids the "muddy average" failure of a single taste vector.)
3. **Retrieval** — facet keywords drive Unsplash search (not random). Every
   fetched image is persisted to a growing local **corpus**, so the rankable pool
   grows across sessions and the API rate limit stops mattering.
4. **Ranking** — candidates scored by max cosine to any facet centroid (with
   maturity shrinkage) minus a Rocchio dislike term, then **MMR** reranked for
   diversity + near-dup culling, with ~25% exploration woven in.

## how dreams work

`keep → Claude describes → Claude decides if worth generating → [facet accrues
worthy images] → Claude writes a concrete prompt → image model generates,
conditioned on your real kept images as visual references → /dreams`

Each dream comes from **one coherent facet** and is **grounded in your actual
images** (the image model sees them), so output matches your taste.

## run it

```bash
npm install
npm run dev   # http://localhost:3000  (or http://<lan-ip>:3000 from your phone)
```

### keys (`.env.local`, gitignored)

```bash
UNSPLASH_ACCESS_KEY=...   # image source (free; without it, falls back to picsum)
ANTHROPIC_API_KEY=...     # the taste brain (describe / decide / prompt-writing)
OPENROUTER_API_KEY=...    # image generation (default model: Nano Banana 2)
```

Image model is swappable via `OPENROUTER_IMAGE_MODEL` (e.g.
`google/gemini-3-pro-image`, `bytedance/seedream-4.5`). `FAL_KEY` /
`TOGETHER_API_KEY` are alternative providers. Generation tuning:
`TROVE_GEN_THRESHOLD` (worthy images per facet before it dreams, default 2).

## stack

Next.js 16 (App Router) · TypeScript · `motion` (swipe) · transformers.js (CLIP) ·
Claude (Anthropic) · OpenRouter/Nano Banana · Unsplash · JSON-file storage. No DB,
no auth — deliberately local-first.

## data (all gitignored, local-only)

`data/state.json` (swipes, library index, taste, prefs) · `data/embeddings.json`
(CLIP vectors) · `data/facets.json` · `data/corpus.json` · `data/dreams.json` ·
`/library` (kept image files) · `/generated` (AI images) · `/.models` (CLIP weights)

## known issues

From an adversarial code review ([`specs/code-review.html`](specs/code-review.html)):

- **Data loss under fast swiping** — `state.json` mutations aren't serialized;
  concurrent requests can clobber each other. *(fix: single mutex + one combined
  write per keep)*
- **Non-atomic writes** — a crash mid-write can corrupt a store. *(fix:
  temp-file + rename)*
- **SSRF** — server fetches URLs from the request body unvalidated. *(fix:
  allowlist hosts / look up by id server-side)*
- **Taste pollution** — kept dreams fold into the real taste vector.
- k-means facet ids are non-deterministic across recomputes; some swallowed
  errors; full-corpus rescoring per request.

These are the next session's work. The product logic is solid; the storage layer
needs hardening before it's trustworthy.

## roadmap

- harden persistence (mutex + atomic writes + atomic per-keep transaction)
- recency decay on taste; separate "dream taste" from retrieval taste
- stable facet ids; keep-rate exploit-vs-explore proof in the UI
- undo last swipe; collections

MIT.
