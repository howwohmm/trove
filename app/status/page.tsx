"use client";

import { useEffect, useState } from "react";

interface Status {
  keeps: number;
  skips: number;
  keepRate: number | null;
  corpus: number;
  facets: { id: string; label: string | null; members: number; importance: number }[];
  pool: { bucket: string; status: string; n: number }[];
  servedMix: { deck_source: string | null; n: number }[];
  avgDwellMs: number | null;
  unsplash: { configured: boolean; rate: { remaining: number; limit: number; at: number } | null };
  errors: { at: number; where: string; message: string }[];
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div style={{ background: "var(--bg-raised)", border: "1px solid var(--line)", borderRadius: "var(--radius)", padding: "0.9rem 1rem" }}>
      <div style={{ fontSize: "1.4rem", fontWeight: 400 }}>{value}</div>
      <div className="small muted">{label}</div>
    </div>
  );
}

export function StatusPage() {
  const [s, setS] = useState<Status | null>(null);

  useEffect(() => {
    const load = () => fetch("/api/status").then((r) => r.json()).then(setS).catch(() => {});
    load();
    const t = setInterval(load, 8000);
    return () => clearInterval(t);
  }, []);

  if (!s) return <main className="page muted small">loading…</main>;

  const pooled = (b: string) => s.pool.find((p) => p.bucket === b && p.status === "pooled")?.n ?? 0;
  const servedTotal = s.servedMix.reduce((x, m) => x + m.n, 0) || 1;
  const served = (b: string) => Math.round(((s.servedMix.find((m) => m.deck_source === b)?.n ?? 0) / servedTotal) * 100);

  return (
    <main className="page">
      <h1 style={{ fontSize: "1.1rem", marginBottom: "1.2rem" }}>status</h1>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: "0.8rem", marginBottom: "1.6rem" }}>
        <Stat label="keeps" value={s.keeps} />
        <Stat label="skips" value={s.skips} />
        <Stat label="keep rate" value={s.keepRate !== null ? `${s.keepRate}%` : "—"} />
        <Stat label="corpus (embedded)" value={s.corpus} />
        <Stat label="avg dwell" value={s.avgDwellMs ? `${(s.avgDwellMs / 1000).toFixed(1)}s` : "—"} />
        <Stat
          label="unsplash"
          value={s.unsplash.configured ? (s.unsplash.rate ? `${s.unsplash.rate.remaining}/${s.unsplash.rate.limit}` : "ready") : "off"}
        />
      </div>

      <h2 className="small muted" style={{ marginBottom: "0.6rem" }}>pool depth · served mix (target 60/25/15)</h2>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(120px, 1fr))", gap: "0.8rem", marginBottom: "1.6rem", maxWidth: 540 }}>
        {(["exploit", "adjacent", "explore"] as const).map((b) => (
          <Stat key={b} label={`${b} · served ${served(b)}%`} value={pooled(b)} />
        ))}
      </div>

      <h2 className="small muted" style={{ marginBottom: "0.6rem" }}>facets</h2>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", marginBottom: "1.6rem" }}>
        {s.facets
          .sort((a, b) => b.importance - a.importance)
          .map((f) => (
            <span key={f.id} className="chip">
              {f.label ?? f.id} · {f.members}
            </span>
          ))}
      </div>

      <h2 className="small muted" style={{ marginBottom: "0.6rem" }}>
        recent errors {s.errors.length === 0 && <span className="faint">— none</span>}
      </h2>
      {s.errors.length > 0 && (
        <div style={{ fontFamily: "monospace", fontSize: "0.72rem", color: "var(--skip)", display: "grid", gap: "0.3rem" }}>
          {s.errors.map((e, i) => (
            <div key={i}>
              {new Date(e.at).toLocaleTimeString()} [{e.where}] {e.message}
            </div>
          ))}
        </div>
      )}
    </main>
  );
}

export default StatusPage;
