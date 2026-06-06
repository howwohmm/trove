// persistent candidate corpus. every image we ever fetch is saved here so the
// rankable pool GROWS across sessions — image bytes come from the CDN (free),
// only the embedding (cached separately) matters for ranking. this is what makes
// the 50 req/hr unsplash limit stop mattering.

import { promises as fs } from "fs";
import path from "path";
import type { Candidate } from "./types";

const FILE = path.join(process.cwd(), "data", "corpus.json");
const MAX = 5000; // cap so the json/pool stays sane for a personal tool

let cache: Candidate[] | null = null;
let writeChain: Promise<void> = Promise.resolve();

async function load(): Promise<Candidate[]> {
  if (cache) return cache;
  try {
    cache = JSON.parse(await fs.readFile(FILE, "utf8")) as Candidate[];
  } catch {
    cache = [];
  }
  return cache;
}

function persist() {
  writeChain = writeChain.then(async () => {
    await fs.mkdir(path.dirname(FILE), { recursive: true });
    await fs.writeFile(FILE, JSON.stringify(cache ?? []));
  });
  return writeChain;
}

export async function addToCorpus(cands: Candidate[]): Promise<void> {
  const c = await load();
  const have = new Set(c.map((x) => x.id));
  let added = 0;
  for (const cand of cands) {
    if (have.has(cand.id)) continue;
    c.push(cand);
    have.add(cand.id);
    added++;
  }
  if (c.length > MAX) c.splice(0, c.length - MAX); // drop oldest
  if (added) await persist();
}

export async function getCorpus(): Promise<Candidate[]> {
  return load();
}
