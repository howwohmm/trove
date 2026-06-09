// the ONLY outbound-fetch path in trove. every url goes through the allowlist
// (v1's C2/SSRF: the server fetched urls straight from request bodies — never again).

const ALLOWED_HOSTS = new Set([
  "api.unsplash.com",
  "images.unsplash.com",
  "plus.unsplash.com",
  "picsum.photos",
  "fastly.picsum.photos",
]);

export function safeFetch(url: string, init?: RequestInit): Promise<Response> {
  const u = new URL(url);
  if (u.protocol !== "https:" || !ALLOWED_HOSTS.has(u.hostname)) {
    throw new Error(`fetch blocked by allowlist: ${u.hostname}`);
  }
  return fetch(url, init);
}

export interface SourcePhoto {
  id: string;
  source: "unsplash" | "picsum";
  url: string; // display-size url (~800w)
  thumbUrl: string; // small url for embedding (~400w)
  fullUrl: string; // full-res for download-on-keep
  width: number;
  height: number;
  color?: string;
  author?: string;
  authorUrl?: string;
  downloadLocation?: string;
}

interface UnsplashPhoto {
  id: string;
  width: number;
  height: number;
  color?: string;
  urls: { raw: string; full: string; regular: string; small: string };
  user?: { name?: string; links?: { html?: string } };
  links?: { html?: string; download_location?: string };
}

let lastRate: { remaining: number; limit: number; at: number } | null = null;
export function getUnsplashRate() {
  return lastRate;
}

function captureRate(res: Response): void {
  const r = res.headers.get("x-ratelimit-remaining");
  const l = res.headers.get("x-ratelimit-limit");
  if (r !== null && l !== null) lastRate = { remaining: +r, limit: +l, at: Date.now() };
}

function unsplashKey(): string | null {
  return process.env.UNSPLASH_ACCESS_KEY ?? null;
}

function mapUnsplash(ph: UnsplashPhoto): SourcePhoto {
  return {
    id: `unsplash-${ph.id}`,
    source: "unsplash",
    url: ph.urls.regular,
    thumbUrl: ph.urls.small,
    fullUrl: ph.urls.full,
    width: ph.width,
    height: ph.height,
    color: ph.color,
    author: ph.user?.name,
    authorUrl: ph.user?.links?.html,
    downloadLocation: ph.links?.download_location,
  };
}

export async function searchUnsplash(query: string, perPage = 24): Promise<SourcePhoto[]> {
  const key = unsplashKey();
  if (!key) return [];
  const res = await safeFetch(
    `https://api.unsplash.com/search/photos?query=${encodeURIComponent(query)}` +
      `&per_page=${perPage}&orientation=portrait&content_filter=high&client_id=${key}`,
    { cache: "no-store" }
  );
  captureRate(res);
  if (!res.ok) throw new Error(`unsplash search ${res.status}`);
  const data = (await res.json()) as { results: UnsplashPhoto[] };
  return (data.results ?? []).map(mapUnsplash);
}

export async function randomUnsplash(count = 24): Promise<SourcePhoto[]> {
  const key = unsplashKey();
  if (!key) return [];
  const res = await safeFetch(
    `https://api.unsplash.com/photos/random?count=${count}&orientation=portrait&content_filter=high&client_id=${key}`,
    { cache: "no-store" }
  );
  captureRate(res);
  if (!res.ok) throw new Error(`unsplash random ${res.status}`);
  return ((await res.json()) as UnsplashPhoto[]).map(mapUnsplash);
}

/** unsplash api compliance: hit download_location when a photo is kept */
export async function triggerUnsplashDownload(downloadLocation: string): Promise<void> {
  const key = unsplashKey();
  if (!key) return;
  const url = new URL(downloadLocation);
  if (url.hostname !== "api.unsplash.com") return;
  url.searchParams.set("client_id", key);
  const res = await safeFetch(url.toString(), { cache: "no-store" });
  captureRate(res);
}

interface PicsumPhoto {
  id: string;
  author: string;
  width: number;
  height: number;
  url: string;
}

/** zero-config fallback: ~300 curated picsum photos */
export async function picsumPool(): Promise<SourcePhoto[]> {
  const all: SourcePhoto[] = [];
  for (const p of [1, 2, 3]) {
    const res = await safeFetch(`https://picsum.photos/v2/list?page=${p}&limit=100`, {
      next: { revalidate: 86400 },
    });
    if (!res.ok) continue;
    const photos = (await res.json()) as PicsumPhoto[];
    for (const ph of photos) {
      all.push({
        id: `picsum-${ph.id}`,
        source: "picsum",
        url: `https://picsum.photos/id/${ph.id}/800/1100`,
        thumbUrl: `https://picsum.photos/id/${ph.id}/400/550`,
        fullUrl: `https://picsum.photos/id/${ph.id}/${ph.width}/${ph.height}`,
        width: 800,
        height: 1100,
        author: ph.author,
      });
    }
  }
  return all;
}

export function hasUnsplash(): boolean {
  return Boolean(unsplashKey());
}
