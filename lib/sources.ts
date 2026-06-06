// pluggable image source. default: lorem picsum (real curated photography,
// zero config). if UNSPLASH_ACCESS_KEY is set, uses unsplash for better taste.
// personal single-user tool — no public redistribution, so sourcing is low-risk.

import type { Candidate } from "./types";

const CARD_W = 800;
const CARD_H = 1100;

let picsumCache: Candidate[] | null = null;

interface PicsumPhoto {
  id: string;
  author: string;
  width: number;
  height: number;
  url: string;
}

async function fetchPicsumPool(): Promise<Candidate[]> {
  if (picsumCache) return picsumCache;
  const pages = [1, 2, 3, 4, 5]; // ~500 curated photos
  const all: Candidate[] = [];
  for (const p of pages) {
    try {
      const res = await fetch(
        `https://picsum.photos/v2/list?page=${p}&limit=100`,
        { next: { revalidate: 86400 } }
      );
      if (!res.ok) continue;
      const photos = (await res.json()) as PicsumPhoto[];
      for (const ph of photos) {
        all.push({
          id: `picsum-${ph.id}`,
          url: `https://picsum.photos/id/${ph.id}/${CARD_W}/${CARD_H}`,
          downloadUrl: `https://picsum.photos/id/${ph.id}/${ph.width}/${ph.height}`,
          width: CARD_W,
          height: CARD_H,
          author: ph.author,
          link: ph.url,
          source: "picsum",
        });
      }
    } catch {
      // skip page on error
    }
  }
  picsumCache = all;
  return all;
}

interface UnsplashPhoto {
  id: string;
  width: number;
  height: number;
  urls: { regular: string; full: string };
  user: { name: string };
  links: { html: string };
}

// growing in-memory pool of unsplash candidates. demo tier is 50 req/hr, so we
// cache aggressively and only call the api when we're low on UNSEEN photos.
let unsplashCache: Candidate[] = [];

async function topUpUnsplash(key: string): Promise<void> {
  try {
    const res = await fetch(
      `https://api.unsplash.com/photos/random?count=30&orientation=portrait&client_id=${key}`,
      { cache: "no-store" }
    );
    if (!res.ok) return;
    const photos = (await res.json()) as UnsplashPhoto[];
    const have = new Set(unsplashCache.map((c) => c.id));
    for (const ph of photos) {
      const id = `unsplash-${ph.id}`;
      if (have.has(id)) continue;
      unsplashCache.push({
        id,
        url: ph.urls.regular,
        downloadUrl: ph.urls.full,
        width: ph.width,
        height: ph.height,
        author: ph.user?.name,
        link: ph.links?.html,
        source: "unsplash",
      });
    }
  } catch {
    // keep whatever we have on failure
  }
}

// ensure ~40 unseen photos are cached, topping up at most a few times per call
async function ensureUnsplash(key: string, seen: Set<string>): Promise<Candidate[]> {
  let tries = 0;
  while (unsplashCache.filter((c) => !seen.has(c.id)).length < 40 && tries < 2) {
    await topUpUnsplash(key);
    tries++;
  }
  return unsplashCache;
}

export function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// the full unseen pool, in source order — ranking happens on top of this.
export async function getFreshPool(
  seen: Set<string>,
  limit = 200
): Promise<Candidate[]> {
  const key = process.env.UNSPLASH_ACCESS_KEY;
  const pool = key ? await ensureUnsplash(key, seen) : await fetchPicsumPool();
  return pool.filter((c) => !seen.has(c.id)).slice(0, limit);
}

// cold-start helper: up to n unseen candidates, shuffled.
export async function getCandidates(
  n: number,
  seen: Set<string>
): Promise<Candidate[]> {
  const fresh = await getFreshPool(seen, 500);
  return shuffle(fresh).slice(0, n);
}
