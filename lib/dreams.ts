// the dream pipeline: kept images -> describe -> decide (worth?) -> when enough
// worthy aesthetics accumulate, synthesize a fresh prompt -> generate -> store.
// runs in the background off the swipe path. no-ops without ANTHROPIC_API_KEY.

import { promises as fs } from "fs";
import path from "path";
import { getLibrary } from "./store";
import {
  hasClaude,
  describe,
  decide,
  synthesizePrompt,
  mutatePrompt,
  type Description,
} from "./claude";
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

export type DreamStatus = "pending" | "kept" | "passed";

export interface Dream {
  id: string;
  prompt: string;
  sourceIds: string[];
  file: string;
  provider: string;
  ts: number;
  status: DreamStatus; // swipe verdict on the dream itself
  parentId?: string; // dream this one was bred from (lineage)
  generation: number; // 0 = born from real keeps, n = n mutations deep
}

interface DreamStore {
  descriptions: Record<string, StoredDesc>;
  dreams: Dream[];
}

let cache: DreamStore | null = null;
let writeChain: Promise<void> = Promise.resolve();

// serial generation queue: ticks and breeds run one-at-a-time, never dropped,
// never colliding on dream ids. (image gen + claude calls are the bottleneck.)
let genChain: Promise<unknown> = Promise.resolve();
function exclusive<T>(fn: () => Promise<T>): Promise<T> {
  const run = genChain.then(fn, fn);
  genChain = run.then(
    () => {},
    () => {}
  );
  return run;
}

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

// record a swipe verdict on a dream
export async function markDream(id: string, status: DreamStatus): Promise<void> {
  const store = await load();
  const d = store.dreams.find((x) => x.id === id);
  if (d) {
    d.status = status;
    await persist();
  }
}

// breed a kept dream: mutate its prompt and generate a child (next generation).
// runs in the background off the swipe path.
export async function evolveDream(id: string): Promise<void> {
  if (!hasClaude() || activeProvider() === "none") return;
  return exclusive(async () => {
    const store = await load();
    const parent = store.dreams.find((x) => x.id === id);
    if (!parent) return;
    const childPrompt = await mutatePrompt(parent.prompt);
    if (!childPrompt) return;
    const childId = dreamId(store);
    let file: string;
    try {
      file = await generateImage(childId, childPrompt);
    } catch {
      return; // gen failed — no child this time
    }
    store.dreams.unshift({
      id: childId,
      prompt: childPrompt,
      sourceIds: parent.sourceIds,
      file,
      provider: activeProvider(),
      ts: Date.now(),
      status: "pending",
      parentId: parent.id,
      generation: (parent.generation ?? 0) + 1,
    });
    await persist();
  });
}

export function scheduleEvolve(id: string): void {
  void evolveDream(id).catch(() => {});
}

// next dream id from the highest existing number (collision-proof under the queue)
function dreamId(store: DreamStore): string {
  const max = store.dreams.reduce((m, d) => {
    const n = parseInt(d.id.replace("dream-", ""), 10) || 0;
    return Math.max(m, n);
  }, 0);
  return `dream-${max + 1}`;
}

export interface TickResult {
  skipped?: string;
  described: number;
  worthyUnused: number;
  generated: boolean;
  prompt?: string;
  provider?: string;
}

// one pass of the pipeline. runs through the serial queue so it never overlaps
// a breed or another tick. safe to call after every like (batches + dedups work).
export async function dreamTick(): Promise<TickResult> {
  if (!hasClaude()) return { skipped: "no ANTHROPIC_API_KEY", described: 0, worthyUnused: 0, generated: false };
  return exclusive(async () => {
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
      status: "pending",
      generation: 0,
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
  });
}

// fire-and-forget trigger for the swipe path. coalesces fast swipes into a single
// tick, but re-runs once if new keeps arrived mid-tick (so none are missed).
let tickRunning = false;
let tickDirty = false;
function runTick(): void {
  tickRunning = true;
  tickDirty = false;
  void dreamTick()
    .catch(() => {})
    .finally(() => {
      tickRunning = false;
      if (tickDirty) runTick();
    });
}
export function scheduleDream(): void {
  if (tickRunning) {
    tickDirty = true;
    return;
  }
  runTick();
}
