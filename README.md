# trove

a personal, single-user tool for curating tasteful images. swipe through a stream
of photos — keep the ones you like and they're downloaded to a local folder,
ready to pull into your projects. think tinder-for-images, but the library is
*yours* and lives on disk.

not a product. no accounts, no cloud, no tracking. just you and your taste.

## how it works

- **swipe right (or →, or ♥)** → image is saved to `/library` on disk + indexed
- **swipe left (or ←, or ✕)** → skipped, never shown again
- the **library** page is a grid of everything you've kept
- all state is a single `data/state.json`; images are real files in `/library`

## run it

```bash
npm install
npm run dev
```

Open http://localhost:3000. To swipe from your phone, run on your laptop and
visit `http://<your-laptop-ip>:3000` on the same network — kept images land on
the laptop where your projects live.

## image source

By default trove pulls from [Lorem Picsum](https://picsum.photos) (real curated
photography, zero config). For better taste, add an
[Unsplash](https://unsplash.com/developers) access key:

```bash
echo "UNSPLASH_ACCESS_KEY=your_key" > .env.local
```

Since trove is personal and never republishes images, sourcing is low-risk —
but if you ever make it public, respect each source's API terms.

## taste algo (phase 2)

Every keep is embedded with CLIP (in-process via transformers.js — no python, no
api) and folded into a running taste vector. Candidates are then ranked by cosine
similarity to your taste, with ~25% exploration mixed in so it keeps learning.
First keep downloads the model (~90MB) once; after that it's instant. The deck
shows whether taste is `calibrating`, `warming up`, or `tuned`.

## dreams — generate images in your taste (phase 3)

trove can also *generate* new images in your aesthetic:

```
keep → Claude describes the aesthetic → Claude DECIDES if it's worth generating
     → [N worthy aesthetics accumulate] → Claude writes a fresh prompt
     → image model generates → /dreams gallery
```

Needs two keys in `.env.local`:

```bash
ANTHROPIC_API_KEY=sk-ant-...   # describe + decider + prompt synthesis
FAL_KEY=...                    # best image output (fal.ai, pay-per-image)
```

**Image model** (premium, on fal.ai) — pick the look via `FAL_MODEL`:

| `FAL_MODEL` | slug | character |
| --- | --- | --- |
| _(default)_ | `fal-ai/flux-pro/v1.1-ultra` | cinematic, photoreal, most "finished" |
| recraft | `fal-ai/recraft/v3/text-to-image` | art-directed, design, illustration |
| ideogram | `fal-ai/ideogram/v3` | editorial, typography |

Cheap fallback: set `TOGETHER_API_KEY` instead for Together FLUX.1-schnell
(~$0.003/image, lower quality). Tune how readily it generates with
`TROVE_GEN_THRESHOLD` (default 3 worthy descriptions).

## roadmap

- collections / tags, undo last swipe
- swipe the dreams too → kept dreams reinforce taste; their prompts get reused/mutated
- more + more varied sources (the decider rewards variety)

## stack

Next.js · React · [motion](https://motion.dev) for the swipe gesture · plain JSON
+ filesystem for storage. No database, no auth — deliberately.

MIT.
