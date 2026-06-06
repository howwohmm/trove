// persistent embedding cache, backed by SQLite. each vector is one BLOB row, so
// adding an embedding is a single targeted write (no more rewriting an 8MB file).
// an in-memory map mirrors the table for fast ranking reads.

import { getDb, floatsToBlob, blobToFloats } from "./db";
import { embedUrl } from "./embed";

let cache: Record<string, number[]> | null = null;

function load(): Record<string, number[]> {
  if (cache) return cache;
  const rows = getDb().prepare("SELECT id, vec FROM embeddings").all() as unknown as {
    id: string;
    vec: Uint8Array;
  }[];
  cache = {};
  for (const r of rows) cache[r.id] = blobToFloats(r.vec);
  return cache;
}

function store(id: string, vec: number[]): void {
  getDb()
    .prepare("INSERT OR REPLACE INTO embeddings(id, vec) VALUES(?, ?)")
    .run(id, floatsToBlob(vec));
  load()[id] = vec;
}

export async function getEmbedding(id: string, url: string): Promise<number[]> {
  const c = load();
  if (c[id]) return c[id];
  const v = await embedUrl(url);
  store(id, v);
  return v;
}

export async function cachedEmbeddings(): Promise<Record<string, number[]>> {
  return load();
}

// embed a batch of candidates in the background to warm the cache.
export function warmEmbeddings(items: { id: string; url: string }[], max = 12): void {
  const todo = items.slice(0, max);
  void (async () => {
    for (const it of todo) {
      try {
        await getEmbedding(it.id, it.url);
      } catch {
        // ignore individual failures
      }
    }
  })();
}
