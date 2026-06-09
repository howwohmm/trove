import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// v1 died here: concurrent read-modify-writes on state.json silently dropped
// swipes. v2's invariant: N concurrent swipes => exactly N rows, no exceptions.

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "trove-test-"));
  process.env.TROVE_DATA_DIR = dir;
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("storage under concurrency", () => {
  it("records 50 concurrent swipes without losing one", async () => {
    const { openDb, insertImage, recordSwipe } = await import("@/lib/db");
    const db = openDb();
    for (let i = 0; i < 50; i++) {
      insertImage(db, {
        id: `img-${i}`,
        source: "picsum",
        url: `https://picsum.photos/id/${i}/600/800`,
        width: 600,
        height: 800,
      });
    }
    await Promise.all(
      Array.from({ length: 50 }, (_, i) =>
        Promise.resolve().then(() =>
          recordSwipe(db, {
            imageId: `img-${i}`,
            action: i % 2 ? "keep" : "skip",
            kind: "real",
            dwellMs: 500 + i,
            deckSource: "exploit",
          })
        )
      )
    );
    const row = db.prepare("SELECT COUNT(*) AS n FROM swipes").get() as { n: number };
    expect(row.n).toBe(50);
    const keeps = db.prepare("SELECT COUNT(*) AS n FROM swipes WHERE action='keep'").get() as { n: number };
    expect(keeps.n).toBe(25);
  });

  it("swipe is transactional: pool row flips to swiped atomically", async () => {
    const { openDb, insertImage, recordSwipe, poolInsert } = await import("@/lib/db");
    const db = openDb();
    insertImage(db, { id: "a", source: "picsum", url: "https://picsum.photos/1", width: 1, height: 1 });
    poolInsert(db, { imageId: "a", source: "facet:f1", bucket: "exploit", score: 0.9 });
    recordSwipe(db, { imageId: "a", action: "keep", kind: "real", dwellMs: 900, deckSource: "exploit" });
    const pool = db.prepare("SELECT status FROM pool WHERE image_id='a'").get() as { status: string };
    expect(pool.status).toBe("swiped");
  });

  it("embedding blobs round-trip as Float32Array(512)", async () => {
    const { openDb, insertImage, setEmbedding, getEmbedding } = await import("@/lib/db");
    const db = openDb();
    insertImage(db, { id: "e", source: "picsum", url: "u", width: 1, height: 1 });
    const v = new Float32Array(512).map(() => Math.random());
    setEmbedding(db, "e", v);
    const out = getEmbedding(db, "e")!;
    expect(out.length).toBe(512);
    expect(out[5]).toBeCloseTo(v[5], 6);
  });
});
