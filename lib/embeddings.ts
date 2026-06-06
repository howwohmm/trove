// persistent embedding cache: id -> vector, stored in data/embeddings.json.
// images are embedded once and reused forever (embedding is a property of the
// image, not the user).

import { promises as fs } from "fs";
import path from "path";
import { embedUrl } from "./embed";

const FILE = path.join(process.cwd(), "data", "embeddings.json");

let cache: Record<string, number[]> | null = null;
let writeChain: Promise<void> = Promise.resolve();

async function load(): Promise<Record<string, number[]>> {
  if (cache) return cache;
  try {
    cache = JSON.parse(await fs.readFile(FILE, "utf8")) as Record<string, number[]>;
  } catch {
    cache = {};
  }
  return cache;
}

// serialize writes so concurrent embeds don't corrupt the file
function persist() {
  writeChain = writeChain.then(async () => {
    const c = cache ?? {};
    await fs.mkdir(path.dirname(FILE), { recursive: true });
    await fs.writeFile(FILE, JSON.stringify(c));
  });
  return writeChain;
}

export async function getEmbedding(id: string, url: string): Promise<number[]> {
  const c = await load();
  if (c[id]) return c[id];
  const v = await embedUrl(url);
  c[id] = v;
  void persist();
  return v;
}

export async function cachedEmbeddings(): Promise<Record<string, number[]>> {
  return load();
}

// embed a batch of candidates in the background to warm the cache.
// fire-and-forget — fine for a long-running local dev server.
export function warmEmbeddings(
  items: { id: string; url: string }[],
  max = 12
): void {
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
