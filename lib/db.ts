import { DatabaseSync } from "node:sqlite";
import { mkdirSync, copyFileSync, existsSync } from "node:fs";
import { join } from "node:path";

// single source of truth. WAL + transactions. no JSON stores, ever again.

export type Db = DatabaseSync;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS images (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  url TEXT,
  local_path TEXT,
  width INTEGER NOT NULL,
  height INTEGER NOT NULL,
  color TEXT,
  blur_data TEXT,
  author TEXT,
  author_url TEXT,
  download_location TEXT,
  embedding BLOB,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS swipes (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  image_id TEXT NOT NULL REFERENCES images(id),
  action TEXT NOT NULL CHECK(action IN ('keep','skip')),
  kind TEXT NOT NULL DEFAULT 'real' CHECK(kind IN ('real','dream')),
  dwell_ms INTEGER NOT NULL DEFAULT 0,
  deck_source TEXT,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS pool (
  image_id TEXT PRIMARY KEY REFERENCES images(id),
  source TEXT NOT NULL,
  bucket TEXT NOT NULL CHECK(bucket IN ('exploit','adjacent','explore')),
  score REAL NOT NULL,
  status TEXT NOT NULL DEFAULT 'pooled' CHECK(status IN ('pooled','shown','swiped')),
  inserted_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS facets (
  id TEXT PRIMARY KEY,
  medoid_image_id TEXT NOT NULL,
  centroid BLOB NOT NULL,
  member_ids TEXT NOT NULL,
  importance REAL NOT NULL,
  label TEXT,
  keywords TEXT,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS dreams (
  id TEXT PRIMARY KEY,
  facet_id TEXT,
  prompt TEXT,
  parent_id TEXT,
  image_id TEXT REFERENCES images(id),
  status TEXT NOT NULL DEFAULT 'pending',
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT);
CREATE INDEX IF NOT EXISTS idx_pool_bucket ON pool(bucket, status, score DESC);
CREATE INDEX IF NOT EXISTS idx_swipes_kind ON swipes(kind, action);
CREATE INDEX IF NOT EXISTS idx_swipes_image ON swipes(image_id);
`;

export function dataDir(): string {
  return process.env.TROVE_DATA_DIR ?? join(process.cwd(), "data");
}

declare global {
  // survives Next.js dev hot-reload
  var __troveDb: DatabaseSync | undefined;
  var __troveDbPath: string | undefined;
}

export function openDb(): Db {
  const dir = dataDir();
  const path = join(dir, "trove2.db");
  if (globalThis.__troveDb && globalThis.__troveDbPath === path) return globalThis.__troveDb;
  mkdirSync(dir, { recursive: true });
  // boot backup before touching an existing db
  if (existsSync(path)) {
    try {
      copyFileSync(path, path + ".bak");
    } catch {
      /* backup is best-effort; never block boot */
    }
  }
  const db = new DatabaseSync(path);
  db.exec("PRAGMA journal_mode=WAL");
  db.exec("PRAGMA synchronous=NORMAL");
  db.exec("PRAGMA foreign_keys=ON");
  db.exec("PRAGMA busy_timeout=5000");
  db.exec(SCHEMA);
  globalThis.__troveDb = db;
  globalThis.__troveDbPath = path;
  return db;
}

export function tx<T>(db: Db, fn: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try {
    const out = fn();
    db.exec("COMMIT");
    return out;
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

export interface ImageRow {
  id: string;
  source: string;
  url?: string | null;
  local_path?: string | null;
  width: number;
  height: number;
  color?: string | null;
  blur_data?: string | null;
  author?: string | null;
  author_url?: string | null;
  download_location?: string | null;
}

export function insertImage(db: Db, img: ImageRow): void {
  db.prepare(
    `INSERT OR IGNORE INTO images
     (id, source, url, local_path, width, height, color, blur_data, author, author_url, download_location, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    img.id,
    img.source,
    img.url ?? null,
    img.local_path ?? null,
    img.width,
    img.height,
    img.color ?? null,
    img.blur_data ?? null,
    img.author ?? null,
    img.author_url ?? null,
    img.download_location ?? null,
    Date.now()
  );
}

export function setEmbedding(db: Db, imageId: string, v: Float32Array): void {
  db.prepare("UPDATE images SET embedding=? WHERE id=?").run(
    Buffer.from(v.buffer, v.byteOffset, v.byteLength),
    imageId
  );
}

export function getEmbedding(db: Db, imageId: string): Float32Array | null {
  const row = db.prepare("SELECT embedding FROM images WHERE id=?").get(imageId) as
    | { embedding: Uint8Array | null }
    | undefined;
  if (!row?.embedding) return null;
  return blobToVec(row.embedding);
}

export function blobToVec(blob: Uint8Array): Float32Array {
  return new Float32Array(blob.buffer, blob.byteOffset, blob.byteLength / 4);
}

export function vecToBlob(v: Float32Array): Buffer {
  return Buffer.from(v.buffer, v.byteOffset, v.byteLength);
}

export interface SwipeInput {
  imageId: string;
  action: "keep" | "skip";
  kind: "real" | "dream";
  dwellMs: number;
  deckSource?: string;
}

export function recordSwipe(db: Db, s: SwipeInput): void {
  tx(db, () => {
    db.prepare(
      "INSERT INTO swipes (image_id, action, kind, dwell_ms, deck_source, created_at) VALUES (?, ?, ?, ?, ?, ?)"
    ).run(s.imageId, s.action, s.kind, s.dwellMs, s.deckSource ?? null, Date.now());
    db.prepare("UPDATE pool SET status='swiped' WHERE image_id=?").run(s.imageId);
  });
}

export interface PoolInput {
  imageId: string;
  source: string;
  bucket: "exploit" | "adjacent" | "explore";
  score: number;
}

export function poolInsert(db: Db, p: PoolInput): void {
  db.prepare(
    "INSERT OR REPLACE INTO pool (image_id, source, bucket, score, status, inserted_at) VALUES (?, ?, ?, ?, 'pooled', ?)"
  ).run(p.imageId, p.source, p.bucket, p.score, Date.now());
}

export function kvGet(db: Db, key: string): string | null {
  const row = db.prepare("SELECT value FROM kv WHERE key=?").get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

export function kvSet(db: Db, key: string, value: string): void {
  db.prepare("INSERT OR REPLACE INTO kv (key, value) VALUES (?, ?)").run(key, value);
}
