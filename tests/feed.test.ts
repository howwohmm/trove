import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// mock everything that touches the network or the CLIP model
vi.mock("@/lib/embed", () => ({
  embedImage: vi.fn(async (url: string) => {
    // deterministic vector from the url so tests are stable
    const v = new Float32Array(512);
    let h = 0;
    for (const ch of url) h = (h * 31 + ch.charCodeAt(0)) % 997;
    v[h % 512] = 1;
    v[(h * 7 + 3) % 512] = 0.4;
    let n = 0;
    for (const x of v) n += x * x;
    n = Math.sqrt(n);
    return v.map((x) => x / n);
  }),
  embedTexts: vi.fn(async (texts: string[]) =>
    texts.map((_, i) => {
      const v = new Float32Array(512);
      v[i % 512] = 1;
      return v;
    })
  ),
}));

vi.mock("@/lib/sources", () => ({
  hasUnsplash: () => false,
  getUnsplashRate: () => null,
  safeFetch: vi.fn(),
  searchUnsplash: vi.fn(async () => []),
  randomUnsplash: vi.fn(async () => []),
  triggerUnsplashDownload: vi.fn(async () => {}),
  picsumPool: vi.fn(async () =>
    Array.from({ length: 40 }, (_, i) => ({
      id: `picsum-${i}`,
      source: "picsum" as const,
      url: `https://picsum.photos/id/${i}/800/1100`,
      thumbUrl: `https://picsum.photos/id/${i}/400/550`,
      fullUrl: `https://picsum.photos/id/${i}/1200/1600`,
      width: 800,
      height: 1100,
      author: "a",
    }))
  ),
}));

let dir: string;

beforeEach(() => {
  vi.resetModules();
  dir = mkdtempSync(join(tmpdir(), "trove-feed-"));
  process.env.TROVE_DATA_DIR = dir;
  process.env.TROVE_LIBRARY_DIR = join(dir, "library");
  // force a fresh db handle for this test's data dir
  globalThis.__troveDb = undefined;
  globalThis.__troveVocab = undefined;
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("feed", () => {
  it("refill fills the explore pool offline (picsum fallback)", async () => {
    const { openDb } = await import("@/lib/db");
    const { refillPool } = await import("@/lib/feed");
    const db = openDb();
    await refillPool(db);
    const n = (db.prepare("SELECT COUNT(*) AS n FROM pool WHERE status='pooled'").get() as { n: number }).n;
    expect(n).toBeGreaterThan(10);
  });

  it("popDeck marks cards shown and never re-deals them", async () => {
    const { openDb } = await import("@/lib/db");
    const { refillPool, popDeck } = await import("@/lib/feed");
    const db = openDb();
    await refillPool(db);
    const deck1 = popDeck(db, 8);
    expect(deck1.length).toBeGreaterThan(4);
    const ids1 = new Set(deck1.map((c) => c.id));
    const deck2 = popDeck(db, 8);
    for (const c of deck2) expect(ids1.has(c.id)).toBe(false);
  });

  it("cold start serves the explore bucket only", async () => {
    const { openDb } = await import("@/lib/db");
    const { refillPool, popDeck } = await import("@/lib/feed");
    const db = openDb();
    await refillPool(db);
    const deck = popDeck(db, 6);
    for (const c of deck) expect(c.bucket).toBe("explore");
  });

  it("facets appear after enough keeps and get vocab labels", async () => {
    const { openDb, recordSwipe } = await import("@/lib/db");
    const { refillPool, recomputeFacets, popDeck } = await import("@/lib/feed");
    const db = openDb();
    await refillPool(db);
    const deck = popDeck(db, 12);
    for (const c of deck) {
      recordSwipe(db, { imageId: c.id, action: "keep", kind: "real", dwellMs: 1000 });
    }
    await recomputeFacets(db);
    const facets = db.prepare("SELECT * FROM facets").all() as { label: string | null; member_ids: string }[];
    expect(facets.length).toBeGreaterThan(0);
    expect(facets[0].label).toBeTruthy();
    const members = facets.flatMap((f) => JSON.parse(f.member_ids) as string[]);
    expect(members.length).toBe(12);
  });

  it("dream keeps never enter retrieval taste", async () => {
    const { openDb, recordSwipe, insertImage, setEmbedding } = await import("@/lib/db");
    const { recomputeFacets } = await import("@/lib/feed");
    const db = openDb();
    // 3 real keeps + 1 dream keep
    for (let i = 0; i < 4; i++) {
      const id = i < 3 ? `real-${i}` : "dream-x";
      insertImage(db, { id, source: i < 3 ? "picsum" : "dream", url: "u", width: 1, height: 1 });
      const v = new Float32Array(512);
      v[i] = 1;
      setEmbedding(db, id, v);
      recordSwipe(db, { imageId: id, action: "keep", kind: i < 3 ? "real" : "dream", dwellMs: 500 });
    }
    await recomputeFacets(db);
    const facets = db.prepare("SELECT member_ids FROM facets").all() as { member_ids: string }[];
    const members = facets.flatMap((f) => JSON.parse(f.member_ids) as string[]);
    expect(members).not.toContain("dream-x");
  });
});
