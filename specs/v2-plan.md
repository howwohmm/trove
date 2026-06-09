# trove v2 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild trove from scratch as a Pinterest-grade personal taste engine: swipe to curate images, a feed that learns like PinnerSage, a frontend that feels like Pinterest's, on a storage layer that cannot lose data.

**Architecture:** SQLite (node:sqlite, WAL, transactions) is the single source of truth — no JSON stores. The taste model is PinnerSage-lite: Ward-clustered facets of kept-image CLIP embeddings, each represented by a *medoid* (a real image) with time-decayed importance; never a single mean vector. The feed is Smart-Feed-lite: candidates are fetched by a background refill into per-source *pools*, scored at insert, popped by a deck generator that enforces an exploit/adjacent/explore mix and MMR diversity. The frontend is two surfaces — a MotionValue swipe deck (zero re-renders during gesture, decode-ahead) and an absolute-positioned masonry computed synchronously from known aspect ratios with dominant-color placeholders.

**Tech Stack:** Next.js 16 (App Router) · TypeScript · node:sqlite · @huggingface/transformers (CLIP, in-process) · motion · sharp · vitest. ~8 direct deps, same as v1. First-load JS budget ≤170KB gz.

---

## Why v1 died (one paragraph, so the spec carries the lesson)

v1's algorithm was good; its persistence was not. Concurrent read-modify-writes on `state.json` silently dropped swipes (C1); non-atomic writes could corrupt the only copy (C3); the server fetched URLs straight from the request body (C2/SSRF); kept dreams polluted the real taste vector (H3); k-means facet IDs reshuffled on every recompute (M2); and 4–5 UI redesigns in 24h burned ~1500 LOC while the data layer stayed broken. v2 inverts the order: storage hardening is Task 1, the aesthetic is locked before any UI code, and AI-generated images never touch retrieval taste.

## Research these decisions come from

- `specs/` v1 post-mortem (this repo, `main` branch history)
- Pinterest: Smart Feed pools, PinnerSage (Ward + medoids + λ=0.01/day importance), Pixie multi-hit boost, MMR/DPP blending, PID mix control, fresh-content floor
- Pinterest frontend: Gestalt Masonry (absolute positioning, no measure pass when aspect ratios are known, virtualization), dominant-color placeholders, PWA bundle budgets, MotionValue gesture discipline
- Meta: value model `Σ wᵢ·P(actionᵢ) − w_neg·P(see_less)`, graded negatives (fast-skip ≫ slow-skip), *decaying* penalties (never permanent), same-cluster consecutive-card penalty, uncertainty-boosted exploration

## Locked decisions (do not re-litigate during build)

1. **Aesthetic locked before build:** quiet dark — `#262626` warm dark background, Manrope 300/400, lowercase, text-first, generous whitespace, no badges/chrome. One theme. Zero redesigns mid-build.
2. **Storage:** node:sqlite only. WAL + `synchronous=FULL`(NORMAL acceptable with WAL). Every swipe = one transaction. Backup copy on boot.
3. **Security:** API never fetches a URL from a request body. Swipe sends an image `id`; the server resolves the URL from its own `images` row. Outbound fetch allowlist: `images.unsplash.com`, `picsum.photos`, `*.openrouter.ai` responses.
4. **Taste separation:** `swipes.kind` distinguishes `real` vs `dream`. Retrieval taste (facets, anti-taste, session vector) is computed from `real` swipes only.
5. **Facet stability:** new clusters inherit the id of the old cluster whose centroid is nearest (cosine > 0.8), else get a fresh id.
6. **Dreams = last lane.** Port v1's serial `exclusive()` queue onto SQLite. If context/budget runs out it ships in the next session — core must not suffer for it.

## File structure

```
app/
  layout.tsx, globals.css           # quiet dark tokens, Manrope
  page.tsx                          # swipe deck (/)
  library/page.tsx                  # masonry + CLIP text search
  taste/page.tsx                    # facets w/ medoid anchors + importance
  status/page.tsx                   # live dashboard
  dreams/page.tsx                   # dream masonry + swipe (lane: dreams)
  api/deck/route.ts                 # GET next cards (pop from pools)
  api/swipe/route.ts                # POST {imageId, action, dwellMs}
  api/library/route.ts              # GET kept images (paged)
  api/search/route.ts               # GET ?q= CLIP text search over keeps
  api/taste/route.ts                # GET facets
  api/status/route.ts               # GET counters/rates/pool health
  api/img/[id]/route.ts             # serve local image files (path-guarded)
  api/refill/route.ts               # POST trigger pool refill (also auto)
  api/dreams/* (lane: dreams)
lib/
  db.ts          # open db, schema, migrations, tx helper, boot backup
  embed.ts       # CLIP image+text embeddings (transformers.js), Float32 blobs
  taste.ts       # ward clustering, medoids, importance, stable ids, anti-taste, session vector
  score.ts       # value model, multi-hit boost, MMR, mix controller  (PURE — no IO)
  feed.ts        # pools: refill, score-at-insert, pop deck, rescore-on-facet-change
  sources.ts     # unsplash (+download_location trigger, attribution) & picsum, allowlist fetch
  ingest.ts      # download → sharp (w/h/color/blur) → embed → images row, one tx
  dreams.ts      # (lane: dreams) serial queue, claude prompt, openrouter gen
components/
  SwipeDeck.tsx  # MotionValues, ≤3 mounted, decode-ahead 3, dwell timer
  Masonry.tsx    # absolute-positioned, synchronous layout, windowed
  Card.tsx       # dominant-color placeholder → fade-in img
scripts/
  import-v1.ts   # migrate v1 trove.db/state.json + library files → v2 schema
tests/
  score.test.ts  taste.test.ts  feed.test.ts  db-race.test.ts
specs/v2-plan.md (this file)
```

## Schema (lib/db.ts)

```sql
CREATE TABLE IF NOT EXISTS images (
  id TEXT PRIMARY KEY,              -- 'unsplash-<id>' | 'picsum-<id>' | 'dream-<n>'
  source TEXT NOT NULL,             -- unsplash | picsum | dream
  url TEXT,                         -- remote full url (server-resolved only)
  local_path TEXT,                  -- set once kept/downloaded
  width INTEGER NOT NULL, height INTEGER NOT NULL,
  color TEXT,                       -- dominant color hex
  blur_data TEXT,                   -- tiny base64 placeholder (kept images)
  author TEXT, author_url TEXT, download_location TEXT,
  embedding BLOB,                   -- Float32Array(512), unit-normalized
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS swipes (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  image_id TEXT NOT NULL REFERENCES images(id),
  action TEXT NOT NULL CHECK(action IN ('keep','skip')),
  kind TEXT NOT NULL DEFAULT 'real' CHECK(kind IN ('real','dream')),
  dwell_ms INTEGER NOT NULL DEFAULT 0,
  deck_source TEXT,                 -- which pool it came from (exploit|adjacent|explore)
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS pool (
  image_id TEXT PRIMARY KEY REFERENCES images(id),
  source TEXT NOT NULL,             -- 'facet:<id>' | 'explore' | 'knn'
  bucket TEXT NOT NULL,             -- exploit | adjacent | explore
  score REAL NOT NULL,
  status TEXT NOT NULL DEFAULT 'pooled' CHECK(status IN ('pooled','shown','swiped')),
  inserted_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS facets (
  id TEXT PRIMARY KEY,
  medoid_image_id TEXT NOT NULL,
  centroid BLOB NOT NULL,           -- Float32Array(512)
  member_ids TEXT NOT NULL,         -- JSON array
  importance REAL NOT NULL,
  label TEXT, keywords TEXT,        -- claude-named, JSON array (optional)
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS dreams (
  id TEXT PRIMARY KEY, facet_id TEXT, prompt TEXT, parent_id TEXT,
  image_id TEXT REFERENCES images(id), status TEXT, created_at INTEGER
);
CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT);
CREATE INDEX IF NOT EXISTS idx_pool_bucket ON pool(bucket, status, score DESC);
CREATE INDEX IF NOT EXISTS idx_swipes_kind ON swipes(kind, action);
```

Pragmas at open: `journal_mode=WAL`, `synchronous=NORMAL`, `foreign_keys=ON`, `busy_timeout=5000`. On boot: `db.backup('data/trove.db.bak')` (node:sqlite supports backup; else fs copy when wal is checkpointed). `tx(fn)` helper wraps BEGIN IMMEDIATE/COMMIT/ROLLBACK.

## Taste engine (lib/taste.ts) — PinnerSage-lite

All vectors unit-normalized ⇒ cosine = dot.

- **Ward clustering** over kept `real` embeddings. Agglomerative, merge by minimum variance increase, cut at threshold `ALPHA` (tune ≈ where 400 keeps → 5–12 facets; start `ALPHA=0.85` in merge-distance terms and calibrate against imported data). O(m²) fine to m≈5k. Recluster every 5 keeps.
- **Medoid** per cluster: `argmin_m Σ_j ‖e_m − e_j‖²`. Facet anchor image in UI = the medoid.
- **Importance:** `Σ_swipes e^(−0.01 · days_since)` per facet. Drives refill sampling + deck quotas.
- **Stable ids:** match new→old by centroid cosine > 0.8 (greedy, best-first); unmatched get `f<kv-counter>`.
- **Anti-taste:** per-swipe negative weight `w = dwell_ms < 1200 ? 1.0 : 0.4` (fast-left is a strong "see less"); store decayed anti-vectors as the weighted mean of recent (≤90d) skip embeddings, half-life 14 days. Penalty is *decaying*, never a permanent ban.
- **Session vector:** decayed mean of last 10 `real` keeps (weight `0.8^i`), recomputed per request — cheap.

## Scoring (lib/score.ts) — pure functions, fully unit-tested

```
relevance(c) = 0.55·maxFacetCos(c) + 0.25·sessionCos(c) + 0.20·multiHit(c)
multiHit(c)  = (Σ_{q∈last10keeps} √max(0,cos(c,q)) / 10)²        // Pixie
penalty(c)   = 0.5·max(0, cos(c, antiTaste))                      // clamped (v1 N3 bug fixed)
explore(c)   = ε · 1/√(1 + swipesNear(c))                         // uncertainty boost, ε=0.1
score(c)     = relevance(c) − penalty(c) + explore(c)
```

- **MMR deck assembly:** next = `argmax(score − 0.3·maxSimToPicked)`; near-dup cull at cos > 0.95 vs seen/picked.
- **Consecutive-facet penalty:** `score *= 0.85^k` for k-th consecutive same-facet card (Meta re-rank heuristic).
- **Mix controller:** targets exploit/adjacent/explore = 60/25/15. Proportional: track served ratio over last 100 cards, nudge pop quotas toward target. Exploration floor: every deck ≥ 1 explore card.
- **Cold start:** < 15 keeps → rank by diversity sampling (k-means++ style spread) instead of facet cosine.

## Feed (lib/feed.ts) — Smart-Feed-lite

- **Refill** (background, after swipe response + on deck-low): sample 3 facets ∝ importance → per facet: Unsplash search by facet keywords (or medoid-similar from local corpus when offline) → ingest-lite (metadata + embedding from remote thumb, no disk save) → score at insert → `pool`. Explore bucket fills from Unsplash editorial/random topics. Rate-limit aware (capture headers like v1's sources.ts).
- **Pop deck:** top-N per bucket per mix controller, MMR-blend, mark `shown`. Shown cards never re-scored mid-session (materialized-feed principle).
- **Rescore** pooled (not shown) rows only when facets change (every 5 keeps), not per request — fixes v1 H5 full-corpus rescan.
- **Keep path** (one transaction): swipe row + image `local_path` update after download + pool status — then *outside* the tx: sharp placeholder gen, facet recluster check, Unsplash `download_location` trigger (compliance).

## Frontend

- **globals.css:** quiet dark tokens — bg `#262626`, fg `#e8e6e1`, muted `#8a877f`, Manrope 300/400 via fontshare/google, lowercase headings, no border chrome.
- **SwipeDeck:** `useMotionValue(x)` + `useTransform` → rotate/opacity. Drag x, exit on `|offset|>100 || |velocity|>500`, spring carries velocity. `touch-action: pan-y`, `user-select:none`. ≤3 mounted cards (stacked scale 0.95/y 8). Decode-ahead: `new Image().decode()` for next 3. Dwell timer = mount→swipe ms, sent with swipe. Optimistic: animate immediately, POST async, queue retries on failure. Keyboard ←/→.
- **Masonry:** layout computed synchronously from stored w/h (shortest-column algorithm, absolute positioning) — no measure pass, no CLS. Windowed: render only rows within viewport ±70%. Cells: dominant-color box → `<img>` fade-in (opacity only), lazy, Unsplash `?w=<col>&dpr=` srcset, local via `/api/img`.
- **Pages:** `/` deck with facet chips (filter deck to one facet); `/library` masonry + text-search bar (CLIP text emb vs keeps); `/taste` facet cards (medoid image, label, importance bar, n members); `/status` pool depths, keep-rate, served mix vs target, api rate remaining, last errors (no silent catch — errors land here).

## Tasks (lanes)

### Lane 0 — scaffold (inline)
- [ ] `npm create next-app` equivalents by hand: package.json (next@16, react, motion, sharp, @huggingface/transformers, @anthropic-ai/sdk, vitest, typescript), tsconfig, next.config (images unoptimized for remote? no — allow unsplash domain), globals.css with quiet-dark tokens, layout.
- [ ] Commit: `v2: scaffold — quiet dark, lean deps`

### Lane 1 — storage (db.ts) + race test FIRST
- [ ] tests/db-race.test.ts: open temp db, fire 50 concurrent `recordSwipe`, assert `count(*)=50` and no error. Write test → fail → implement `db.ts` (schema above, tx helper, boot backup) → pass.
- [ ] Commit: `v2: sqlite storage, transactional swipes, race-proof`

### Lane 2 — taste.ts + score.ts (pure, TDD)
- [ ] tests/taste.test.ts: ward merges two obvious blobs into 2 clusters; medoid is the central point; importance decays (old swipe ≈ e^-0.01·days); stable-id holds when one point added; anti-taste clamps at 0.
- [ ] tests/score.test.ts: multi-hit boosts a candidate similar to many keeps over one similar to a single keep; MMR never picks two near-dups adjacent; consecutive-facet penalty kicks in; mix controller converges served ratio → target within 200 simulated pops.
- [ ] Commit per file.

### Lane 3 — embed.ts + sources.ts + ingest.ts
- [ ] CLIP via @huggingface/transformers (image + text towers, explicit projection — v1 stack-playbook learning), cache to `.models`. Unit-normalize. Store Float32 blobs.
- [ ] Unsplash client: search/topics/editorial, rate-header capture, `download_location` trigger on keep, UTM attribution fields persisted. Allowlist fetch helper (the ONLY outbound fetch path).
- [ ] Commit: `v2: clip + sources + ingest`

### Lane 4 — feed.ts + API routes
- [ ] tests/feed.test.ts (mock sources): refill fills buckets ∝ facet importance; pop marks shown; shown never rescored; swipe in one tx.
- [ ] Routes: deck/swipe/refill/library/search/taste/status/img (path-guard `..`).
- [ ] Commit: `v2: smart-feed pools + api`

### Lane 5 — import v1 data
- [ ] scripts/import-v1.ts: read `data/trove.db` (+ fall back to `data.backup-*/state.json`+`embeddings.json`), copy 402 library files' metadata, embeddings, swipe history (kind=real; dreams → kind=dream), sharp-derive w/h/color/blur for each local file. Run it. Verify counts: images≈402+, swipes≈v1 count, facets compute to 5–12.
- [ ] Commit: `v2: v1 data imported`

### Lane 6 — frontend
- [ ] SwipeDeck, Masonry, Card per spec above. Pages wired. Headless screenshot each page (feedback_ui_anchor: screenshot before claiming done).
- [ ] Commit per surface.

### Lane 7 — dreams (cut line — ship without it if budget runs out)
- [ ] Port v1 serial queue onto sqlite `dreams` table; merged describe+decide single Claude call (cost learning); Seedream/Nano Banana via OpenRouter; dream keeps → `kind='dream'`, never retrieval taste.

### Lane 8 — verify + ship
- [ ] `npm test` all green; `npm run build` clean; dev server up; screenshot `/`, `/library`, `/taste`, `/status`; swipe 5 cards via browser; confirm swipes persisted; push branch.

## Self-review notes
- Every v1 critical (C1 race, C3 atomicity, C2 SSRF, H3 taste pollution, H5 rescan, M2 facet ids, N3 clamp) has an explicit fix above.
- Spec coverage of research: PinnerSage→taste.ts, SmartFeed→feed.ts, Pixie→multiHit, Meta value/negatives/diversity→score.ts, Pinterest frontend→components.
- YAGNI cuts vs v1: taste-map canvas (deprecated — unclear use), MCP server (later), Lottie (never), tune page (folded into /taste later).
