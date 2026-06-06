// Unsplash image URLs are imgix-backed, so we can request an exactly-sized,
// auto-format (AVIF/WebP), compressed variant for the grid — 60-80% smaller than
// the fixed ~1080px url. Pure function (safe to import client-side). CDN bytes
// don't count against the Unsplash rate limit, so this is free.

export function optimized(url: string, w = 320, dpr = 2): string {
  try {
    const u = new URL(url);
    if (!u.hostname.includes("images.unsplash.com")) return url; // only Unsplash CDN
    u.searchParams.set("w", String(w));
    u.searchParams.set("dpr", String(dpr));
    u.searchParams.set("q", "55");
    u.searchParams.set("auto", "format,compress");
    u.searchParams.set("fit", "clip"); // preserve aspect ratio → masonry heights
    u.searchParams.delete("h");
    return u.toString();
  } catch {
    return url;
  }
}
