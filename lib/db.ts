// single SQLite database for all of trove's state — replaces the five fragile
// JSON stores. node:sqlite is built into Node (no native binary to corrupt).
// every write is a transaction → atomic + isolated, so the data-loss bugs
// (lost updates, torn writes) are gone by construction. synchronous API means
// a read-modify-write inside one function never yields the event loop → race-free.

import { DatabaseSync } from "node:sqlite";
import fsSync from "fs";
import path from "path";

const DATA_DIR = path.join(process.cwd(), "data");
const DB_PATH = path.join(DATA_DIR, "trove.db");

let db: DatabaseSync | null = null;

export function getDb(): DatabaseSync {
  if (db) return db;
  fsSync.mkdirSync(DATA_DIR, { recursive: true });
  const d = new DatabaseSync(DB_PATH);
  d.exec("PRAGMA journal_mode = WAL;");
  d.exec("PRAGMA synchronous = FULL;"); // durable: never lose a committed keep
  d.exec(`
    CREATE TABLE IF NOT EXISTS meta        (k TEXT PRIMARY KEY, v TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS swipes      (id TEXT PRIMARY KEY, dir TEXT NOT NULL, ts INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS library     (id TEXT PRIMARY KEY, json TEXT NOT NULL, ts INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS embeddings  (id TEXT PRIMARY KEY, vec BLOB NOT NULL);
    CREATE TABLE IF NOT EXISTS corpus      (id TEXT PRIMARY KEY, json TEXT NOT NULL, ts INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS descriptions(id TEXT PRIMARY KEY, json TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS dreams      (id TEXT PRIMARY KEY, json TEXT NOT NULL, ts INTEGER NOT NULL);
  `);
  db = d;
  migrateFromJson(d);
  return d;
}

// ---- meta (singletons: taste vector, count, prefs, facets) ----
export function getMeta(k: string): string | null {
  const row = getDb().prepare("SELECT v FROM meta WHERE k = ?").get(k) as unknown as { v: string } | undefined;
  return row?.v ?? null;
}
export function setMeta(k: string, v: string): void {
  getDb().prepare("INSERT INTO meta(k, v) VALUES(?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v").run(k, v);
}

// ---- embedding BLOB <-> float[] ----
export function floatsToBlob(v: number[]): Uint8Array {
  return new Uint8Array(Float32Array.from(v).buffer);
}
export function blobToFloats(b: Uint8Array): number[] {
  return Array.from(new Float32Array(b.buffer, b.byteOffset, Math.floor(b.byteLength / 4)));
}

// run fn inside a transaction (synchronous; rolls back on throw)
export function tx<T>(fn: () => T): T {
  const d = getDb();
  d.exec("BEGIN");
  try {
    const r = fn();
    d.exec("COMMIT");
    return r;
  } catch (e) {
    d.exec("ROLLBACK");
    throw e;
  }
}

// ---- one-time import of the legacy JSON stores ----
function migrateFromJson(d: DatabaseSync): void {
  const already = d.prepare("SELECT v FROM meta WHERE k = 'migrated_json'").get();
  if (already) return;

  const read = (f: string): unknown => {
    try {
      return JSON.parse(fsSync.readFileSync(path.join(DATA_DIR, f), "utf8"));
    } catch {
      return null;
    }
  };

  d.exec("BEGIN");
  try {
    const state = read("state.json") as {
      taste?: number[] | null;
      tasteCount?: number;
      prefs?: { steer: string; avoid: string };
      swipes?: { id: string; dir: string; ts: number }[];
      library?: ({ id: string; ts?: number })[];
    } | null;
    if (state) {
      if (state.taste) setMetaIn(d, "taste", JSON.stringify(state.taste));
      setMetaIn(d, "tasteCount", String(state.tasteCount ?? 0));
      setMetaIn(d, "prefs", JSON.stringify(state.prefs ?? { steer: "", avoid: "" }));
      const sw = d.prepare("INSERT OR REPLACE INTO swipes(id, dir, ts) VALUES(?, ?, ?)");
      for (const s of state.swipes ?? []) sw.run(s.id, s.dir, s.ts);
      const lib = d.prepare("INSERT OR REPLACE INTO library(id, json, ts) VALUES(?, ?, ?)");
      for (const l of state.library ?? []) lib.run(l.id, JSON.stringify(l), l.ts ?? 0);
    }

    const emb = read("embeddings.json") as Record<string, number[]> | null;
    if (emb) {
      const ins = d.prepare("INSERT OR REPLACE INTO embeddings(id, vec) VALUES(?, ?)");
      for (const [id, vec] of Object.entries(emb)) ins.run(id, floatsToBlob(vec));
    }

    const corp = read("corpus.json") as ({ id: string })[] | null;
    if (Array.isArray(corp)) {
      const ins = d.prepare("INSERT OR REPLACE INTO corpus(id, json, ts) VALUES(?, ?, ?)");
      corp.forEach((c, i) => ins.run(c.id, JSON.stringify(c), i));
    }

    const dr = read("dreams.json") as {
      descriptions?: Record<string, { id: string }>;
      dreams?: ({ id: string; ts?: number })[];
    } | null;
    if (dr) {
      const di = d.prepare("INSERT OR REPLACE INTO descriptions(id, json) VALUES(?, ?)");
      for (const desc of Object.values(dr.descriptions ?? {})) di.run(desc.id, JSON.stringify(desc));
      const dm = d.prepare("INSERT OR REPLACE INTO dreams(id, json, ts) VALUES(?, ?, ?)");
      for (const dm0 of dr.dreams ?? []) dm.run(dm0.id, JSON.stringify(dm0), dm0.ts ?? 0);
    }

    const fac = read("facets.json");
    if (fac) setMetaIn(d, "facets", JSON.stringify(fac));

    setMetaIn(d, "migrated_json", "1");
    d.exec("COMMIT");
  } catch (e) {
    d.exec("ROLLBACK");
    throw e;
  }
}

function setMetaIn(d: DatabaseSync, k: string, v: string): void {
  d.prepare("INSERT INTO meta(k, v) VALUES(?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v").run(k, v);
}
