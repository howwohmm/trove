// the dream pipeline: kept images -> describe -> decide (worth?) -> when enough
// worthy aesthetics accumulate, synthesize a fresh prompt -> generate -> store.
// runs in the background off the swipe path. no-ops without ANTHROPIC_API_KEY.

import { promises as fs } from "fs";
import path from "path";
import { getLibrary } from "./store";
import { hasClaude, describe, decide, synthesizePrompt, type Description } from "./claude";
import { generateImage, activeProvider } from "./generate";

const FILE = path.join(process.cwd(), "data", "dreams.json");

const GEN_THRESHOLD = Number(process.env.TROVE_GEN_THRESHOLD) || 3; // worthy descriptions before a dream
const DESCRIBE_MAX = 8; // cap describe work per tick to bound cost/latency

interface StoredDesc extends Description {
  id: string;
  worth: boolean;
  score: number;
  reason: string;
  used: boolean; // already folded into a generated dream
  ts: number;
}

export interface Dream {
  id: string;
  prompt: string;
  sourceIds: string[];
  file: string;
  provider: string;
  ts: number;
}

interface DreamStore {
  descriptions: Record<string, StoredDesc>;
  dreams: Dream[];
}

let cache: DreamStore | null = null;
let writeChain: Promise<void> = Promise.resolve();
let running = false;

async function load(): Promise<DreamStore> {
  if (cache) return cache;
  try {
    cache = JSON.parse(await fs.readFile(FILE, "utf8")) as DreamStore;
  } catch {
    cache = { descriptions: {}, dreams: [] };
  }
  return cache;
}

function persist() {
  writeChain = writeChain.then(async () => {
    await fs.mkdir(path.dirname(FILE), { recursive: true });
    await fs.writeFile(FILE, JSON.stringify(cache ?? { descriptions: {}, dreams: [] }, null, 2));
  });
  return writeChain;
}

export async function getDreams(): Promise<Dream[]> {
  return (await load()).dreams;
}

// counter for a tiny dream id (no Date.now / Math.random in id to stay readable)
function dreamId(store: DreamStore): string {
  return `dream-${store.dreams.length + 1}`;
}

export interface TickResult {
  skipped?: string;
  described: number;
  worthyUnused: number;
  generated: boolean;
  prompt?: string;
  provider?: string;
}

// one pass of the pipeline. safe to call after every like (self-locks + batches).
export async function dreamTick(): Promise<TickResult> {
  if (!hasClaude()) return { skipped: "no ANTHROPIC_API_KEY", described: 0, worthyUnused: 0, generated: false };
  if (running) return { skipped: "already running", described: 0, worthyUnused: 0, generated: false };
  running = true;
  try {
    const store = await load();
    const library = await getLibrary();

    // 1. describe + decide any kept images we haven't processed yet
    const pending = library.filter((l) => !store.descriptions[l.id]).slice(0, DESCRIBE_MAX);
    let described = 0;
    for (const item of pending) {
      try {
        const desc = await describe(item.file);
        if (!desc) continue;
        const existingQualities = Object.values(store.descriptions).flatMap((d) => d.qualities);
        const verdict = await decide(desc, existingQualities);
        store.descriptions[item.id] = {
          ...desc,
          id: item.id,
          worth: verdict?.worth ?? false,
          score: verdict?.score ?? 0,
          reason: verdict?.reason ?? "",
          used: false,
          ts: Date.now(),
        };
        described++;
      } catch {
        // skip this image on failure
      }
    }
    if (described) await persist();

    // 2. if enough worthy-but-unused aesthetics, dream
    const worthyUnused = Object.values(store.descriptions).filter((d) => d.worth && !d.used);
    if (worthyUnused.length < GEN_THRESHOLD) {
      return { described, worthyUnused: worthyUnused.length, generated: false };
    }

    const batch = worthyUnused.slice(0, 6);
    const prompt = await synthesizePrompt(batch);
    if (!prompt) return { described, worthyUnused: worthyUnused.length, generated: false };

    const id = dreamId(store);
    let file: string;
    try {
      file = await generateImage(id, prompt);
    } catch (e) {
      // no provider key / gen failure — keep the prompt, don't burn the worthy set
      return { described, worthyUnused: worthyUnused.length, generated: false, prompt, provider: String(e) };
    }
    store.dreams.unshift({
      id,
      prompt,
      sourceIds: batch.map((d) => d.id),
      file,
      provider: activeProvider(),
      ts: Date.now(),
    });
    for (const d of batch) store.descriptions[d.id].used = true;
    await persist();

    return {
      described,
      worthyUnused: worthyUnused.length,
      generated: true,
      prompt,
      provider: activeProvider(),
    };
  } finally {
    running = false;
  }
}

// fire-and-forget trigger for the swipe path
export function scheduleDream(): void {
  void dreamTick().catch(() => {});
}
