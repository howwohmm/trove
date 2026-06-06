// the dream pipeline: kept images -> describe -> decide (worth?) -> when enough
// worthy aesthetics accumulate, synthesize a fresh prompt -> generate -> store.
// runs in the background off the swipe path. no-ops without ANTHROPIC_API_KEY.

import { promises as fs } from "fs";
import path from "path";
import { getLibrary, getPrefs } from "./store";
import {
  hasClaude,
  describe,
  decide,
  synthesizePrompt,
  mutatePrompt,
  type Description,
} from "./claude";
import { generateImage, activeProvider, GENERATED_DIR } from "./generate";
import { getFacets } from "./facets";
import { getDb, tx } from "./db";

// a generated image as a base64 data url, to use as a visual reference
async function genRefDataUrl(file: string): Promise<string | null> {
  try {
    const buf = await fs.readFile(path.join(GENERATED_DIR, file));
    const ext = file.endsWith(".png") ? "png" : "jpeg";
    return `data:image/${ext};base64,${buf.toString("base64")}`;
  } catch {
    return null;
  }
}

const PER_FACET_THRESHOLD = Number(process.env.TROVE_GEN_THRESHOLD) || 2; // worthy imgs in one facet before it dreams
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
  facetLabel?: string; // which taste facet this dream came from
}

interface DreamStore {
  descriptions: Record<string, StoredDesc>;
  dreams: Dream[];
}

let cache: DreamStore | null = null;

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

// in-memory working copy mirrors the SQLite tables; persist() flushes it back in
// one transaction (atomic — no torn writes).
async function load(): Promise<DreamStore> {
  if (cache) return cache;
  const db = getDb();
  const descRows = db.prepare("SELECT json FROM descriptions").all() as unknown as { json: string }[];
  const dreamRows = db.prepare("SELECT json FROM dreams ORDER BY ts DESC").all() as unknown as { json: string }[];
  const descriptions: Record<string, StoredDesc> = {};
  for (const r of descRows) {
    const d = JSON.parse(r.json) as StoredDesc;
    descriptions[d.id] = d;
  }
  cache = { descriptions, dreams: dreamRows.map((r) => JSON.parse(r.json) as Dream) };
  return cache;
}

function persist(): void {
  const c = cache;
  if (!c) return;
  const db = getDb();
  tx(() => {
    const di = db.prepare("INSERT OR REPLACE INTO descriptions(id, json) VALUES(?, ?)");
    for (const d of Object.values(c.descriptions)) di.run(d.id, JSON.stringify(d));
    const dm = db.prepare("INSERT OR REPLACE INTO dreams(id, json, ts) VALUES(?, ?, ?)");
    for (const dr of c.dreams) dm.run(dr.id, JSON.stringify(dr), dr.ts);
  });
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
    const childPrompt = await mutatePrompt(parent.prompt, await getPrefs());
    if (!childPrompt) return;
    const childId = dreamId(store);
    // condition the child on the loved parent image so it stays in the same look
    const parentRef = await genRefDataUrl(parent.file);
    let file: string;
    try {
      file = await generateImage(childId, childPrompt, parentRef ? [parentRef] : []);
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
      facetLabel: parent.facetLabel,
    });
    await persist();
  });
}

export function scheduleEvolve(id: string): void {
  void evolveDream(id).catch(() => {});
}

// generate a dream from one chosen facet (per-facet control)
export async function dreamFromFacet(facetId: string): Promise<TickResult> {
  const base = { described: 0, worthyUnused: 0, generated: false };
  if (!hasClaude() || activeProvider() === "none") return { ...base, skipped: "not configured" };
  return exclusive(async () => {
    const facet = (await getFacets()).find((f) => f.id === facetId);
    if (!facet) return { ...base, skipped: "no such facet" };
    const pseudo: Description = {
      text: `the aesthetic: ${facet.label}`,
      qualities: facet.queries,
      distinctiveness: 1,
    };
    const prompt = await synthesizePrompt([pseudo], await getPrefs());
    if (!prompt) return base;
    const lib = await getLibrary();
    const libById = new Map(lib.map((l) => [l.id, l]));
    const refs = facet.memberIds
      .map((mid) => libById.get(mid)?.url)
      .filter((u): u is string => !!u)
      .slice(0, 3);
    const store = await load();
    const id = dreamId(store);
    let file: string;
    try {
      file = await generateImage(id, prompt, refs);
    } catch {
      return base;
    }
    store.dreams.unshift({
      id,
      prompt,
      sourceIds: facet.memberIds.slice(0, 3),
      file,
      provider: activeProvider(),
      ts: Date.now(),
      status: "pending",
      generation: 0,
      facetLabel: facet.label,
    });
    await persist();
    return { ...base, generated: true, prompt, provider: activeProvider() };
  });
}

// regenerate from a user-edited prompt (direct control, no claude)
export async function regenerateDream(prompt: string): Promise<TickResult> {
  const base = { described: 0, worthyUnused: 0, generated: false };
  if (activeProvider() === "none") return { ...base, skipped: "no image provider" };
  if (!prompt?.trim()) return { ...base, skipped: "empty prompt" };
  return exclusive(async () => {
    const store = await load();
    const id = dreamId(store);
    let file: string;
    try {
      file = await generateImage(id, prompt);
    } catch {
      return base;
    }
    store.dreams.unshift({
      id,
      prompt,
      sourceIds: [],
      file,
      provider: activeProvider(),
      ts: Date.now(),
      status: "pending",
      generation: 0,
    });
    await persist();
    return { ...base, generated: true, prompt, provider: activeProvider() };
  });
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
        const desc = await describe(item.url);
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

    // 2. dream from ONE coherent facet (never a blend), grounded by its real images
    const worthyTotal = Object.values(store.descriptions).filter((d) => d.worth && !d.used).length;
    const facets = await getFacets();
    const libById = new Map(library.map((l) => [l.id, l]));

    let chosen: (typeof facets)[number] | null = null;
    let chosenDescs: StoredDesc[] = [];
    for (const f of facets) {
      const worthy = f.memberIds
        .map((mid) => store.descriptions[mid])
        .filter((d): d is StoredDesc => !!d && d.worth && !d.used);
      if (worthy.length >= PER_FACET_THRESHOLD) {
        chosen = f;
        chosenDescs = worthy.slice(0, 5);
        break;
      }
    }
    if (!chosen) return { described, worthyUnused: worthyTotal, generated: false };

    const prompt = await synthesizePrompt(chosenDescs, await getPrefs());
    if (!prompt) return { described, worthyUnused: worthyTotal, generated: false };

    // reference images = real kept images from this facet (public urls → Nano Banana
    // conditions on them so the output matches the actual look)
    const refs = chosen.memberIds
      .map((mid) => libById.get(mid)?.url)
      .filter((u): u is string => !!u)
      .slice(0, 3);

    const id = dreamId(store);
    let file: string;
    try {
      file = await generateImage(id, prompt, refs);
    } catch (e) {
      return { described, worthyUnused: worthyTotal, generated: false, prompt, provider: String(e) };
    }
    store.dreams.unshift({
      id,
      prompt,
      sourceIds: chosenDescs.map((d) => d.id),
      file,
      provider: activeProvider(),
      ts: Date.now(),
      status: "pending",
      generation: 0,
      facetLabel: chosen.label,
    });
    for (const d of chosenDescs) store.descriptions[d.id].used = true;
    await persist();

    return {
      described,
      worthyUnused: worthyTotal,
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
