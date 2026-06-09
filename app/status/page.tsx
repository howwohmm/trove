"use client";

// /status — the activity log, lab notes. specs/design-contract.md.
// numberflow stats, mono pool depths, quiet dot-row, reverse-chron log.

import { useEffect, useState } from "react";
import { motion } from "motion/react";
import NumberFlow from "@number-flow/react";
import { quiet } from "@/lib/motion";
import { Footer } from "@/components/Footer";

const quietEase: [number, number, number, number] = [...quiet];

interface LogItem {
  at: number;
  line: string;
  tone?: "error";
}

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
  log: LogItem[];
  judgedDays: boolean[];
}

function Stat({ label, value, suffix }: { label: string; value: number | null; suffix?: string }) {
  return (
    <div>
      <div style={{ fontSize: "1.4rem", fontWeight: 300, lineHeight: 1.15 }}>
        {value === null ? (
          <span className="faint">—</span>
        ) : (
          <>
            <NumberFlow value={value} />
            {suffix && <span style={{ fontSize: "0.9rem", color: "var(--muted)" }}>{suffix}</span>}
          </>
        )}
      </div>
      <div className="t-hint" style={{ marginTop: "0.2rem" }}>
        {label}
      </div>
    </div>
  );
}

function hhmm(at: number): string {
  const d = new Date(at);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export function StatusPage() {
  const [s, setS] = useState<Status | null>(null);

  useEffect(() => {
    const load = () => fetch("/api/status").then((r) => r.json()).then(setS).catch(() => {});
    load();
    const t = setInterval(load, 8000);
    return () => clearInterval(t);
  }, []);

  if (!s) {
    return (
      <main className="page">
        <p className="t-hint breathing">the lab is waking…</p>
      </main>
    );
  }

  const pooled = (b: string) => s.pool.find((p) => p.bucket === b && p.status === "pooled")?.n ?? 0;
  const servedTotal = s.servedMix.reduce((x, m) => x + m.n, 0) || 1;
  const served = (b: string) =>
    Math.round(((s.servedMix.find((m) => m.deck_source === b)?.n ?? 0) / servedTotal) * 100);
  const judged = s.judgedDays.filter(Boolean).length;

  return (
    <main className="page">
      <div className="page-body">
        <h1 className="t-display" style={{ marginBottom: "2rem" }}>
          status
        </h1>

        {/* stats row */}
        <div style={{ display: "flex", flexWrap: "wrap", gap: "2.5rem 3.5rem", marginBottom: "2.2rem" }}>
          <Stat label="keeps" value={s.keeps} />
          <Stat label="keep rate" value={s.keepRate} suffix="%" />
          <Stat label="corpus" value={s.corpus} />
          <Stat
            label="avg dwell"
            value={s.avgDwellMs ? Math.round(s.avgDwellMs / 100) / 10 : null}
            suffix="s"
          />
          <Stat
            label="unsplash remaining"
            value={s.unsplash.configured && s.unsplash.rate ? s.unsplash.rate.remaining : null}
          />
        </div>

        {/* pool depths */}
        <p className="t-mono" style={{ marginBottom: "0.4rem" }}>
          pool · exploit {pooled("exploit")} · adjacent {pooled("adjacent")} · explore {pooled("explore")}
        </p>
        <p className="t-mono" style={{ marginBottom: "2.2rem" }}>
          served mix {served("exploit")}/{served("adjacent")}/{served("explore")} · target 60/25/15
        </p>

        {/* dot-row */}
        <div style={{ display: "flex", alignItems: "center", gap: "0.45rem", marginBottom: "2.2rem" }}>
          {s.judgedDays.map((on, i) => (
            <span
              key={i}
              style={{
                width: 6,
                height: 6,
                borderRadius: "50%",
                background: on ? "var(--muted)" : "transparent",
                border: on ? "none" : "1px solid var(--line)",
                display: "inline-block",
              }}
            />
          ))}
          <span className="t-mono" style={{ marginLeft: "0.5rem" }}>
            judged {judged} of the last 7 days
          </span>
        </div>

        {/* the log */}
        <div style={{ maxHeight: "50vh", overflowY: "auto", display: "flex", flexDirection: "column", gap: "0.45rem" }}>
          {s.log.map((e) => (
            <motion.div
              key={`${e.at}:${e.line}`}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.15, ease: quietEase }}
              style={{ display: "flex", gap: "0.9rem", alignItems: "baseline" }}
            >
              <span
                style={{
                  fontFamily: "var(--mono)",
                  fontSize: "0.68rem",
                  letterSpacing: "0.08em",
                  color: "var(--faint)",
                  flexShrink: 0,
                }}
              >
                {hhmm(e.at)}
              </span>
              <span className="t-copy" style={{ color: e.tone === "error" ? "var(--safelight)" : undefined }}>
                {e.line}
              </span>
            </motion.div>
          ))}
          {s.log.length === 0 && <p className="t-hint">nothing logged yet. swipe 20 to wake the engine.</p>}
        </div>
      </div>
      <Footer />
    </main>
  );
}

export default StatusPage;
