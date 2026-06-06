// pluggable image source. default: lorem picsum (real curated photography,
// zero config). if UNSPLASH_ACCESS_KEY is set, uses unsplash for better taste.
// personal single-user tool — no public redistribution, so sourcing is low-risk.

import type { Candidate } from "./types";
import { getLibrary } from "./store";

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
  tags?: { title: string }[];
}

// growing in-memory pool of unsplash candidates. demo tier is 50 req/hr, so we
// cache aggressively: each search query is fetched once, results merged here.
let unsplashCache: Candidate[] = [];
const fetchedQueries = new Set<string>();

// last-seen rate-limit headers from real unsplash calls (so /status never spends
// a request just to check the limit)
let lastRate: { remaining: number; limit: number; at: number } | null = null;
export function getUnsplashRate() {
  return lastRate;
}
function captureRate(res: Response): void {
  const r = res.headers.get("x-ratelimit-remaining");
  const l = res.headers.get("x-ratelimit-limit");
  if (r !== null && l !== null) lastRate = { remaining: +r, limit: +l, at: Date.now() };
}

function mapPhoto(ph: UnsplashPhoto): Candidate {
  return {
    id: `unsplash-${ph.id}`,
    url: ph.urls.regular,
    downloadUrl: ph.urls.full,
    width: ph.width,
    height: ph.height,
    author: ph.user?.name,
    link: ph.links?.html,
    tags: ph.tags?.map((t) => t.title).filter(Boolean),
    source: "unsplash",
  };
}

function mergeIntoCache(photos: UnsplashPhoto[]): void {
  const have = new Set(unsplashCache.map((c) => c.id));
  for (const ph of photos) {
    if (have.has(`unsplash-${ph.id}`)) continue;
    unsplashCache.push(mapPhoto(ph));
  }
}

function unseenCount(seen: Set<string>): number {
  return unsplashCache.filter((c) => !seen.has(c.id)).length;
}

// retrieval: pull images RELEVANT to a taste keyword (the pinterest move)
async function searchUnsplash(query: string, key: string): Promise<void> {
  const q = query.trim().toLowerCase();
  if (!q || fetchedQueries.has(q)) return;
  fetchedQueries.add(q);
  try {
    const res = await fetch(
      `https://api.unsplash.com/search/photos?query=${encodeURIComponent(q)}` +
        `&per_page=30&orientation=portrait&content_filter=high&client_id=${key}`,
      { cache: "no-store" }
    );
    captureRate(res);
    if (!res.ok) return;
    const data = (await res.json()) as { results: UnsplashPhoto[] };
    mergeIntoCache(data.results ?? []);
  } catch {
    // keep whatever we have
  }
}

// cold-start / fallback: random editorial photos
async function topUpUnsplash(key: string): Promise<void> {
  try {
    const res = await fetch(
      `https://api.unsplash.com/photos/random?count=30&orientation=portrait&client_id=${key}`,
      { cache: "no-store" }
    );
    captureRate(res);
    if (!res.ok) return;
    mergeIntoCache((await res.json()) as UnsplashPhoto[]);
  } catch {
    // keep whatever we have
  }
}

// the top taste keywords from what you've kept — drive retrieval
async function libraryTagQueries(limit = 5): Promise<string[]> {
  const lib = await getLibrary();
  const freq = new Map<string, number>();
  for (const it of lib) for (const t of it.tags ?? []) freq.set(t, (freq.get(t) ?? 0) + 1);
  return [...freq.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([t]) => t);
}

// fill the cache with taste-relevant photos (search by keywords), falling back
// to random only when we can't get enough relevant unseen ones (e.g. cold start).
async function ensureUnsplash(
  key: string,
  seen: Set<string>,
  queries?: string[]
): Promise<Candidate[]> {
  const qs = queries ?? (await libraryTagQueries());
  for (const q of qs) {
    if (unseenCount(seen) >= 40) break;
    await searchUnsplash(q, key);
  }
  let tries = 0;
  while (unseenCount(seen) < 40 && tries < 2) {
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
// pass opts.queries to retrieve a specific taste (e.g. one facet's keywords).
export async function getFreshPool(
  seen: Set<string>,
  limit = 200,
  opts?: { queries?: string[] }
): Promise<Candidate[]> {
  const key = process.env.UNSPLASH_ACCESS_KEY;
  const pool = key
    ? await ensureUnsplash(key, seen, opts?.queries)
    : await fetchPicsumPool();
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
