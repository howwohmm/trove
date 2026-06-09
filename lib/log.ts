// no silent catches in v2 — failures land in a kv ring buffer surfaced on /status.

import { kvGet, kvSet, type Db } from "@/lib/db";

export interface LoggedError {
  at: number;
  where: string;
  message: string;
}

export function logError(db: Db, where: string, err: unknown): void {
  try {
    const list: LoggedError[] = JSON.parse(kvGet(db, "errors") ?? "[]");
    list.push({ at: Date.now(), where, message: err instanceof Error ? err.message : String(err) });
    kvSet(db, "errors", JSON.stringify(list.slice(-50)));
  } catch {
    // the logger itself must never throw
  }
  console.error(`[trove:${where}]`, err);
}

export function recentErrors(db: Db): LoggedError[] {
  try {
    return JSON.parse(kvGet(db, "errors") ?? "[]");
  } catch {
    return [];
  }
}
