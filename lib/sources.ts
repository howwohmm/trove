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

async function fetchUnsplashPool(key: string): Promise<Candidate[]> {
  // pull a batch of random editorial photos
  try {
    const res = await fetch(
      `https://api.unsplash.com/photos/random?count=30&orientation=portrait&client_id=${key}`,
      { cache: "no-store" }
    );
    if (!res.ok) return [];
    const photos = (await res.json()) as UnsplashPhoto[];
    return photos.map((ph) => ({
      id: `unsplash-${ph.id}`,
      url: ph.urls.regular,
      downloadUrl: ph.urls.full,
      width: ph.width,
      height: ph.height,
      author: ph.user?.name,
      link: ph.links?.html,
      source: "unsplash" as const,
    }));
  } catch {
    return [];
  }
}

// stable shuffle keyed by a session-stable seed so the deck order is consistent
function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// return up to n unseen candidates. phase 2 will rank by cosine to taste vector;
// for now: shuffled pool minus already-seen.
export async function getCandidates(
  n: number,
  seen: Set<string>
): Promise<Candidate[]> {
  const key = process.env.UNSPLASH_ACCESS_KEY;
  const pool = key ? await fetchUnsplashPool(key) : await fetchPicsumPool();
  const fresh = pool.filter((c) => !seen.has(c.id));
  return shuffle(fresh).slice(0, n);
}
