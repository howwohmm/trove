"use client";

import { useEffect, useState } from "react";

interface FacetCard {
  id: string;
  label: string;
  keywords: string[];
  importance: number; // % share
  members: number;
  medoid: string | null;
}

export function TastePage() {
  const [facets, setFacets] = useState<FacetCard[]>([]);

  useEffect(() => {
    fetch("/api/taste")
      .then((r) => r.json())
      .then((d: { facets: FacetCard[] }) => setFacets(d.facets))
      .catch(() => {});
  }, []);

  return (
    <main className="page">
      <h1 style={{ fontSize: "1.1rem", marginBottom: "0.4rem" }}>your taste</h1>
      <p className="small muted" style={{ marginBottom: "1.5rem" }}>
        {facets.length} facets, clustered from what you keep. each anchor is a real image — the medoid of its
        cluster.
      </p>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))",
          gap: "1rem",
        }}
      >
        {facets.map((f) => (
          <div
            key={f.id}
            style={{
              background: "var(--bg-raised)",
              borderRadius: "var(--radius)",
              overflow: "hidden",
              border: "1px solid var(--line)",
            }}
          >
            {f.medoid && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={f.medoid}
                alt={f.label}
                loading="lazy"
                style={{ width: "100%", aspectRatio: "4 / 3", objectFit: "cover", display: "block" }}
              />
            )}
            <div style={{ padding: "0.8rem 0.9rem 1rem" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                <span style={{ fontWeight: 400 }}>{f.label}</span>
                <span className="small muted">{f.members}</span>
              </div>
              <div
                style={{
                  marginTop: "0.6rem",
                  height: 3,
                  borderRadius: 2,
                  background: "var(--line)",
                  overflow: "hidden",
                }}
              >
                <div style={{ width: `${f.importance}%`, height: "100%", background: "var(--muted)" }} />
              </div>
              <p className="small faint" style={{ marginTop: "0.55rem", lineHeight: 1.5 }}>
                {f.keywords.slice(2).join(" · ")}
              </p>
            </div>
          </div>
        ))}
      </div>
    </main>
  );
}

export default TastePage;
