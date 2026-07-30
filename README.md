# trove

A personal, single-user tool to curate tasteful images and to generate new
ones in your own taste.

Swipe through photos. The photos you keep land on disk and train a
recommendation engine that learns your eye. They also seed an AI that
generates fresh images that look like *you*.

Not a product. No accounts, no cloud, no tracking. Local-first, OSS. Just
you and your taste.

> **status: day-one prototype.** The recommendation engine and the
> generation loop work well. The JSON persistence layer has known
> concurrency and atomicity issues. See [Known issues](#known-issues).
> Do not trust it yet with data you cannot lose.

## what it does

- **swipe** (`/`): A Tinder-style deck. Right = keep. A keep downloads the
  image to `/library`, trains taste, and can seed a dream. Left = skip.
  Facet chips filter the feed by one of your taste clusters.
- **library** (`/library`): A full-bleed Pinterest masonry of everything
  you kept.
- **dreams** (`/dreams`): AI images generated in your taste. Swipe them too.
  A keep breeds a mutated child through genetic prompt evolution. A pass
  kills the lineage.
- **tune** (`/tune`): Steer generation with a direction and an avoid-list,
  or "dream from a facet" on demand.
- **status** (`/status`): A live dashboard with API rate and credits, taste
  keeps, keep-rate, facets, corpus size, and dreams. It refreshes every 8s.

## how the recommendation works

(full design: [`specs/recommendation-engine.html`](specs/recommendation-engine.html))

1. **Embeddings**: transformers.js embeds every image with CLIP in-process.
   No GPU, no API.
2. **Facets**: k-means clusters your kept images into taste facets. Claude
   names each facet and gives search keywords. Facets = categories = the
   multi-interest model. This avoids the "muddy average" failure of a
   single taste vector.
3. **Retrieval**: Facet keywords drive the Unsplash search, not random
   queries. The app persists every fetched image to a growing local
   **corpus**. The rankable pool grows across sessions, so the API rate
   limit no longer matters.
4. **Ranking**: The engine scores each candidate by max cosine to any facet
   centroid, with maturity shrinkage, minus a Rocchio dislike term. **MMR**
   then reranks for diversity and culls near-dups. The engine also adds
   about 25% exploration.

## how dreams work

`keep → Claude describes → Claude decides if worth generating → [facet accrues
worthy images] → Claude writes a concrete prompt → image model generates,
conditioned on your real kept images as visual references → /dreams`

Each dream comes from **one coherent facet**. The image model **sees your
actual images**, so the output matches your taste.

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

Set `OPENROUTER_IMAGE_MODEL` to swap the image model, for example
`google/gemini-3-pro-image` or `bytedance/seedream-4.5`. `FAL_KEY` and
`TOGETHER_API_KEY` are alternative providers. `TROVE_GEN_THRESHOLD` sets
the number of worthy images per facet before it dreams (default 2).

## stack

Next.js 16 (App Router) · TypeScript · `motion` (swipe) · transformers.js (CLIP) ·
Claude (Anthropic) · OpenRouter/Nano Banana · Unsplash · JSON-file storage.
No DB, no auth. Local-first by design.

## data (all gitignored, local-only)

`data/state.json` (swipes, library index, taste, prefs) · `data/embeddings.json`
(CLIP vectors) · `data/facets.json` · `data/corpus.json` · `data/dreams.json` ·
`/library` (kept image files) · `/generated` (AI images) · `/.models` (CLIP weights)

## known issues

From an adversarial code review ([`specs/code-review.html`](specs/code-review.html)):

- **Data loss under fast swiping**: The app does not serialize `state.json`
  mutations. Concurrent requests can clobber each other. *(fix: single mutex +
  one combined write per keep)*
- **Non-atomic writes**: A crash mid-write can corrupt a store. *(fix:
  temp-file + rename)*
- **SSRF**: The server fetches URLs from the request body without validation.
  *(fix: allowlist hosts / look up by id server-side)*
- **Taste pollution**: Kept dreams merge into the real taste vector.
- k-means facet ids are non-deterministic across recomputes. The code
  swallows some errors. The app rescores the full corpus on each request.

This is the work for the next session. The product logic is solid. The
storage layer needs hardening before it is trustworthy.

## roadmap

- harden persistence (mutex + atomic writes + atomic per-keep transaction)
- recency decay on taste
- separate "dream taste" from retrieval taste
- stable facet ids
- keep-rate exploit-vs-explore proof in the UI
- undo last swipe
- collections

MIT.
