// server-side JSON store for trove. single-user, no db, no auth.
// state lives in data/state.json; saved image files live in /library.

import { promises as fs } from "fs";
import path from "path";
import type { State, SwipeRecord, LibraryItem } from "./types";
import { runningMean } from "./taste";

const DATA_DIR = path.join(process.cwd(), "data");
const STATE_FILE = path.join(DATA_DIR, "state.json");
export const LIBRARY_DIR = path.join(process.cwd(), "library");

const EMPTY: State = { taste: null, tasteCount: 0, swipes: [], library: [] };

async function ensureDirs() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.mkdir(LIBRARY_DIR, { recursive: true });
}

export async function readState(): Promise<State> {
  try {
    const raw = await fs.readFile(STATE_FILE, "utf8");
    return { ...EMPTY, ...(JSON.parse(raw) as Partial<State>) };
  } catch {
    return { ...EMPTY };
  }
}

async function writeState(state: State): Promise<void> {
  await ensureDirs();
  await fs.writeFile(STATE_FILE, JSON.stringify(state, null, 2), "utf8");
}

// set of ids the user has already swiped — never show twice
export async function seenIds(): Promise<Set<string>> {
  const { swipes } = await readState();
  return new Set(swipes.map((s) => s.id));
}

export async function recordSwipe(rec: SwipeRecord): Promise<void> {
  const state = await readState();
  if (!state.swipes.some((s) => s.id === rec.id)) {
    state.swipes.push(rec);
    await writeState(state);
  }
}

export async function addToLibrary(item: LibraryItem): Promise<void> {
  const state = await readState();
  if (!state.library.some((l) => l.id === item.id)) {
    state.library.unshift(item); // newest first
    await writeState(state);
  }
}

export async function getLibrary(): Promise<LibraryItem[]> {
  const { library } = await readState();
  return library;
}

// fold a liked image's embedding into the taste vector (running mean)
export async function updateTaste(vec: number[]): Promise<void> {
  const state = await readState();
  state.taste = runningMean(state.taste, state.tasteCount, vec);
  state.tasteCount += 1;
  await writeState(state);
}

// download a remote image into /library and return the saved filename
export async function saveImageFile(id: string, url: string): Promise<string> {
  await ensureDirs();
  const res = await fetch(url);
  if (!res.ok) throw new Error(`fetch image failed: ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const ext = extFromContentType(res.headers.get("content-type")) ?? "jpg";
  const file = `${id}.${ext}`;
  await fs.writeFile(path.join(LIBRARY_DIR, file), buf);
  return file;
}

function extFromContentType(ct: string | null): string | null {
  if (!ct) return null;
  if (ct.includes("jpeg")) return "jpg";
  if (ct.includes("png")) return "png";
  if (ct.includes("webp")) return "webp";
  if (ct.includes("avif")) return "avif";
  if (ct.includes("gif")) return "gif";
  return null;
}
