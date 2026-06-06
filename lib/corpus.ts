// persistent candidate corpus, backed by SQLite. every fetched image is one row,
// so the rankable pool grows across sessions and adding candidates is a targeted
// transaction (no whole-file rewrite).

import { getDb, tx } from "./db";
import type { Candidate } from "./types";

const MAX = 5000; // cap so the table stays sane for a personal tool

export async function addToCorpus(cands: Candidate[]): Promise<void> {
  if (!cands.length) return;
  const db = getDb();
  tx(() => {
    const ins = db.prepare("INSERT OR IGNORE INTO corpus(id, json, ts) VALUES(?, ?, ?)");
    const now = Date.now();
    for (const c of cands) ins.run(c.id, JSON.stringify(c), now);
    // evict oldest beyond MAX
    const { n } = db.prepare("SELECT COUNT(*) AS n FROM corpus").get() as unknown as { n: number };
    if (n > MAX) {
      db.prepare("DELETE FROM corpus WHERE id IN (SELECT id FROM corpus ORDER BY ts ASC LIMIT ?)").run(n - MAX);
    }
  });
}

export async function getCorpus(): Promise<Candidate[]> {
  const rows = getDb().prepare("SELECT json FROM corpus").all() as unknown as { json: string }[];
  return rows.map((r) => JSON.parse(r.json) as Candidate);
}
