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

## roadmap

- **phase 2 — taste algo:** embed each image (CLIP), keep a running taste vector
  from your right-swipes, rank candidates by cosine similarity. The `taste` field
  in `state.json` is already reserved for it.
- collections / tags, undo last swipe, more sources.

## stack

Next.js · React · [motion](https://motion.dev) for the swipe gesture · plain JSON
+ filesystem for storage. No database, no auth — deliberately.

MIT.
