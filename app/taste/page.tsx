"use client";

import { useEffect, useState } from "react";
import { optimized } from "@/lib/imgix";

interface Facet {
  id: string;
  label: string;
  size: number;
  queries: string[];
  anchors: { url: string; file: string }[];
}

export default function TastePage() {
  const [facets, setFacets] = useState<Facet[] | null>(null);
  const [dreaming, setDreaming] = useState<string | null>(null);
  const [note, setNote] = useState("");

  useEffect(() => {
    fetch("/api/taste")
      .then((r) => r.json())
      .then((d: { facets: Facet[] }) => setFacets(d.facets))
      .catch(() => setFacets([]));
  }, []);

  const dreamFrom = async (f: Facet) => {
    setDreaming(f.id);
    setNote("");
    try {
      const res = await fetch("/api/dreams/from-facet", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ facetId: f.id }),
      });
      const d = (await res.json()) as { generated: boolean };
      setNote(d.generated ? `dreamed from “${f.label}” → see dreams` : "couldn't generate");
    } catch {
      setNote("couldn't generate");
    } finally {
      setDreaming(null);
    }
  };

  if (!facets) return <p className="hint">reading your taste…</p>;
  if (facets.length === 0)
    return <p className="hint">keep more images — your taste facets form as you swipe.</p>;

  return (
    <div className="taste-page">
      <p className="lib-head">your taste · {facets.length} facets, learned from what you keep</p>
      {facets.map((f) => (
        <section className="facet-block" key={f.id}>
          <div className="facet-meta">
            <h2>{f.label}</h2>
            <span className="facet-count">{f.size} images</span>
            <div className="facet-keys">
              {f.queries.map((q) => (
                <span key={q} className="facet-pill">{q}</span>
              ))}
            </div>
            <button className="save" disabled={dreaming === f.id} onClick={() => dreamFrom(f)}>
              {dreaming === f.id ? "dreaming…" : "dream from this"}
            </button>
          </div>
          <div className="facet-anchors">
            {f.anchors.map((a) => (
              <a
                key={a.file}
                href={`/api/img/${a.file}`}
                target="_blank"
                rel="noreferrer"
                className="anchor"
                title="an anchor image for this facet"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={optimized(a.url, 220)} alt="" loading="lazy" />
              </a>
            ))}
          </div>
        </section>
      ))}
      {note && <p className="lib-head" style={{ marginTop: "1rem" }}>{note}</p>}
    </div>
  );
}
