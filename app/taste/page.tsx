"use client";

// /taste — the revelation, not a database. specs/design-contract.md.
// full-width facet rows, medoid develop-ins, one identity line computed
// from data. the page should feel like reading a profile of yourself.

import { useCallback, useEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import { settle, quiet } from "@/lib/motion";
import { Footer } from "@/components/Footer";

interface FacetRow {
  id: string;
  label: string;
  keywords: string[];
  importance: number; // % share of taste
  members: number;
  medoid: string | null;
  keptShare: number; // % of all keeps
  lastFed: number | null;
}

function relativeTime(at: number | null): string {
  if (!at) return "never";
  const s = Math.max(0, Date.now() - at) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

// nearest human word for a kept-share percentage
function fractionWord(pct: number): string {
  if (pct > 45) return "most";
  const words: [number, string][] = [
    [33, "a third"],
    [25, "a quarter"],
    [20, "a fifth"],
  ];
  let best: [number, string] | null = null;
  for (const w of words) {
    if (Math.abs(pct - w[0]) <= 4 && (!best || Math.abs(pct - w[0]) < Math.abs(pct - best[0]))) best = w;
  }
  return best ? best[1] : `${pct}%`;
}

const quietEase: [number, number, number, number] = [...quiet];

const developIn = {
  initial: { opacity: 0, filter: "blur(12px) brightness(0.4)" },
  whileInView: { opacity: 1, filter: "blur(0px) brightness(1)" },
  viewport: { once: true },
  transition: { duration: 0.6, ease: quietEase },
};

function FacetLabel({ facet, onRenamed }: { facet: FacetRow; onRenamed: (label: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(facet.label);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);

  const save = useCallback(async () => {
    const clean = draft.trim().toLowerCase();
    setEditing(false);
    if (!clean || clean === facet.label) {
      setDraft(facet.label);
      return;
    }
    const res = await fetch("/api/taste", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: facet.id, label: clean }),
    }).catch(() => null);
    if (res?.ok) {
      onRenamed(clean);
      setDraft(clean);
    } else {
      setDraft(facet.label);
    }
  }, [draft, facet.id, facet.label, onRenamed]);

  if (editing) {
    return (
      <input
        ref={inputRef}
        className="t-display"
        value={draft}
        maxLength={60}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => {
          if (e.key === "Enter") save();
          if (e.key === "Escape") {
            setDraft(facet.label);
            setEditing(false);
          }
        }}
        style={{
          background: "none",
          border: "none",
          borderBottom: "1px solid var(--line)",
          outline: "none",
          padding: 0,
          width: "100%",
          maxWidth: "26ch",
        }}
      />
    );
  }

  return (
    <button
      className="t-display facet-label"
      onClick={() => setEditing(true)}
      title="rename"
      style={{ display: "block", textAlign: "left", padding: 0 }}
      onMouseEnter={(e) => (e.currentTarget.style.textDecoration = "underline")}
      onMouseLeave={(e) => (e.currentTarget.style.textDecoration = "none")}
    >
      {facet.label}
    </button>
  );
}

export function TastePage() {
  const [facets, setFacets] = useState<FacetRow[] | null>(null);

  useEffect(() => {
    fetch("/api/taste")
      .then((r) => r.json())
      .then((d: { facets: FacetRow[] }) => setFacets(d.facets))
      .catch(() => setFacets([]));
  }, []);

  const rename = useCallback((id: string, label: string) => {
    setFacets((prev) => (prev ? prev.map((f) => (f.id === id ? { ...f, label } : f)) : prev));
  }, []);

  const top = facets?.[0] ?? null;

  return (
    <main className="page">
      <div className="page-body">
        <h1 className="t-display" style={{ marginBottom: "0.5rem" }}>
          your taste
        </h1>
        <p className="t-hint" style={{ maxWidth: "48ch" }}>
          {facets?.length ?? 0} facets, clustered from what you keep. each anchor is a real image — the medoid
          of its cluster.
        </p>

        {top && (
          <motion.p
            className="t-title"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={settle}
            style={{ margin: "2.5rem 0 0", color: "var(--fg)", maxWidth: "40ch" }}
          >
            {fractionWord(top.keptShare)} of everything you keep is {top.label}
          </motion.p>
        )}

        {facets && facets.length === 0 && (
          <p className="t-copy muted" style={{ marginTop: "2.5rem" }}>
            nothing here yet. that&apos;s fine. swipe 20 to wake the engine.
          </p>
        )}

        <div style={{ marginTop: "4rem", display: "flex", flexDirection: "column", gap: "4.5rem" }}>
          {facets?.map((f, i) => (
            <motion.section
              key={f.id}
              initial={{ opacity: 0, y: 10 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ ...settle, delay: (i % 4) * 0.05 }}
              style={{ display: "flex", gap: "2.2rem", flexWrap: "wrap", alignItems: "flex-start" }}
            >
              {f.medoid && (
                <motion.img
                  src={f.medoid}
                  alt={f.label}
                  loading="lazy"
                  decoding="async"
                  {...developIn}
                  style={{
                    width: "min(340px, 100%)",
                    aspectRatio: "4 / 3",
                    objectFit: "cover",
                    borderRadius: 0,
                    display: "block",
                    flexShrink: 0,
                  }}
                />
              )}
              <div style={{ flex: 1, minWidth: 260, paddingTop: "0.2rem" }}>
                <FacetLabel facet={f} onRenamed={(label) => rename(f.id, label)} />
                <p className="t-mono" style={{ marginTop: "0.9rem" }}>
                  {f.members} kept · {f.importance}% of you · last fed {relativeTime(f.lastFed)}
                </p>
                <div style={{ marginTop: "0.9rem", maxWidth: 420 }}>
                  <motion.div
                    initial={{ scaleX: 0 }}
                    whileInView={{ scaleX: 1 }}
                    viewport={{ once: true }}
                    transition={{ duration: 0.6, ease: quietEase }}
                    style={{
                      width: `${f.importance}%`,
                      height: 2,
                      background: "var(--muted)",
                      transformOrigin: "left",
                    }}
                  />
                </div>
                <p className="t-hint" style={{ marginTop: "0.9rem", maxWidth: "44ch" }}>
                  {f.keywords.slice(2).join(" · ")}
                </p>
              </div>
            </motion.section>
          ))}
        </div>
      </div>
      <Footer />
    </main>
  );
}

export default TastePage;
