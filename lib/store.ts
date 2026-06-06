// state store, now backed by SQLite (lib/db.ts). targeted row writes + synchronous
// transactions mean concurrent swipes can no longer clobber each other (the old
// read-whole-file / write-whole-file race is gone).

import { promises as fs } from "fs";
import path from "path";
import { getDb, getMeta, setMeta, tx } from "./db";
import { runningMean } from "./taste";
import type { State, SwipeRecord, LibraryItem, Prefs } from "./types";

export const LIBRARY_DIR = path.join(process.cwd(), "library");

function emptyPrefs(): Prefs {
  return { steer: "", avoid: "" };
}

export async function readState(): Promise<State> {
  const db = getDb();
  const taste = getMeta("taste");
  const swipes = db.prepare("SELECT id, dir, ts FROM swipes").all() as unknown as SwipeRecord[];
  const library = (
    db.prepare("SELECT json FROM library ORDER BY ts DESC").all() as unknown as { json: string }[]
  ).map((r) => JSON.parse(r.json) as LibraryItem);
  return {
    taste: taste ? (JSON.parse(taste) as number[]) : null,
    tasteCount: Number(getMeta("tasteCount") ?? "0"),
    prefs: JSON.parse(getMeta("prefs") ?? JSON.stringify(emptyPrefs())) as Prefs,
    swipes,
    library,
  };
}

// just the ids the user has swiped — cheap, never show a card twice
export async function seenIds(): Promise<Set<string>> {
  const rows = getDb().prepare("SELECT id FROM swipes").all() as unknown as { id: string }[];
  return new Set(rows.map((r) => r.id));
}

export async function recordSwipe(rec: SwipeRecord): Promise<void> {
  getDb()
    .prepare("INSERT OR IGNORE INTO swipes(id, dir, ts) VALUES(?, ?, ?)")
    .run(rec.id, rec.dir, rec.ts);
}

export async function addToLibrary(item: LibraryItem): Promise<void> {
  getDb()
    .prepare("INSERT OR IGNORE INTO library(id, json, ts) VALUES(?, ?, ?)")
    .run(item.id, JSON.stringify(item), item.ts);
}

export async function getLibrary(): Promise<LibraryItem[]> {
  const rows = getDb().prepare("SELECT json FROM library ORDER BY ts DESC").all() as unknown as { json: string }[];
  return rows.map((r) => JSON.parse(r.json) as LibraryItem);
}

export async function getPrefs(): Promise<Prefs> {
  return JSON.parse(getMeta("prefs") ?? JSON.stringify(emptyPrefs())) as Prefs;
}

export async function setPrefs(prefs: Prefs): Promise<void> {
  setMeta("prefs", JSON.stringify({ steer: prefs.steer ?? "", avoid: prefs.avoid ?? "" }));
}

// fold a liked image's embedding into the taste vector (running mean).
// read + write happen synchronously with no await between → race-free.
export async function updateTaste(vec: number[]): Promise<void> {
  tx(() => {
    const cur = getMeta("taste");
    const count = Number(getMeta("tasteCount") ?? "0");
    const next = runningMean(cur ? (JSON.parse(cur) as number[]) : null, count, vec);
    setMeta("taste", JSON.stringify(next));
    setMeta("tasteCount", String(count + 1));
  });
}

// download a remote image into /library and return the saved filename
export async function saveImageFile(id: string, url: string): Promise<string> {
  await fs.mkdir(LIBRARY_DIR, { recursive: true });
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
