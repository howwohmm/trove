"use client";

import { useEffect, useState } from "react";

interface Status {
  sources: { unsplash: { remaining: number; limit: number; ageSec: number } | null };
  generation: {
    claude: boolean;
    imageProvider: string;
    hasImageProvider: boolean;
    openrouter: { usage: number | null; limit: number | null; remaining: number | null } | null;
  };
  taste: { keeps: number; facets: { label: string; size: number }[]; keepRate: number };
  pool: { corpus: number; embedded: number; swipes: number };
  dreams: { pending: number; kept: number; total: number };
  pipeline: {
    running: boolean;
    lastResult: { generated: boolean; described: number; at: number } | null;
    lastError: { message: string; at: number } | null;
  };
}

function ago(ts?: number): string {
  if (!ts) return "—";
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  return `${Math.round(s / 3600)}h ago`;
}

function Row({ label, value, tone }: { label: string; value: React.ReactNode; tone?: "red" | "yellow" }) {
  return (
    <div className="srow">
      <span className="slabel">{label}</span>
      <span className={`sval ${tone ? `sval--${tone}` : ""}`}>{value}</span>
    </div>
  );
}

export default function StatusPage() {
  const [s, setS] = useState<Status | null>(null);
  const [pulse, setPulse] = useState(false);

  useEffect(() => {
    let live = true;
    const load = () =>
      fetch("/api/status")
        .then((r) => r.json())
        .then((d: Status) => {
          if (!live) return;
          setS(d);
          setPulse(true);
          setTimeout(() => setPulse(false), 400);
        })
        .catch(() => {});
    load();
    const t = setInterval(load, 8000);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, []);

  if (!s) return <p className="hint">reading live status…</p>;

  const uns = s.sources.unsplash;
  const unsTone = uns && uns.remaining <= 5 ? "red" : uns && uns.remaining <= 15 ? "yellow" : undefined;
  const or = s.generation.openrouter;

  return (
    <div className="status">
      <div className="status-head">
        <span className={`dot ${pulse ? "dot--live" : ""}`} /> live · refreshes every 8s
      </div>

      <h2>sources</h2>
      <Row
        label="unsplash / hr"
        value={uns ? `${uns.remaining} / ${uns.limit} left` : "—  (no calls yet)"}
        tone={unsTone}
      />
      {uns && <Row label="↳ last seen" value={`${uns.ageSec}s ago`} />}

      <h2>generation</h2>
      <Row label="taste brain" value={s.generation.claude ? "claude · on" : "off"} tone={s.generation.claude ? undefined : "red"} />
      <Row label="image model" value={s.generation.imageProvider} tone={s.generation.hasImageProvider ? undefined : "red"} />
      {or && (
        <Row
          label="openrouter"
          value={
            or.remaining != null
              ? `$${or.remaining.toFixed(2)} left`
              : `$${(or.usage ?? 0).toFixed(2)} used`
          }
          tone={or.remaining != null && or.remaining < 0.5 ? "red" : undefined}
        />
      )}

      <h2>taste</h2>
      <Row label="keeps folded in" value={s.taste.keeps} />
      <Row label="keep-rate (last 50)" value={`${s.taste.keepRate}%`} tone="yellow" />
      <div className="facet-list">
        {s.taste.facets.map((f) => (
          <span key={f.label} className="facet-pill">
            {f.label} <em>{f.size}</em>
          </span>
        ))}
      </div>

      <h2>pool</h2>
      <Row label="corpus (rankable)" value={s.pool.corpus} />
      <Row
        label="embedded"
        value={`${s.pool.embedded} (${s.pool.corpus ? Math.round((s.pool.embedded / s.pool.corpus) * 100) : 0}%)`}
      />
      <Row label="total swipes" value={s.pool.swipes} />

      <h2>dreams</h2>
      <Row label="to judge" value={s.dreams.pending} tone={s.dreams.pending > 0 ? "yellow" : undefined} />
      <Row label="kept" value={s.dreams.kept} />
      <Row label="generated total" value={s.dreams.total} />

      <h2>pipeline</h2>
      <Row label="dream engine" value={s.pipeline.running ? "running…" : "idle"} />
      <Row
        label="last run"
        value={
          s.pipeline.lastResult
            ? `${s.pipeline.lastResult.generated ? "generated a dream" : "no dream"} · ${ago(s.pipeline.lastResult.at)}`
            : "—"
        }
      />
      {s.pipeline.lastError && (
        <Row label="last error" value={`${s.pipeline.lastError.message.slice(0, 40)} · ${ago(s.pipeline.lastError.at)}`} tone="red" />
      )}
    </div>
  );
}
