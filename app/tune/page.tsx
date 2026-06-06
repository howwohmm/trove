"use client";

import { useEffect, useState } from "react";

interface Facet {
  id: string;
  label: string;
  size: number;
}

export default function TunePage() {
  const [steer, setSteer] = useState("");
  const [avoid, setAvoid] = useState("");
  const [saved, setSaved] = useState(false);
  const [facets, setFacets] = useState<Facet[]>([]);
  const [dreaming, setDreaming] = useState<string | null>(null);
  const [note, setNote] = useState("");

  useEffect(() => {
    fetch("/api/prefs")
      .then((r) => r.json())
      .then((d: { steer: string; avoid: string }) => {
        setSteer(d.steer ?? "");
        setAvoid(d.avoid ?? "");
      })
      .catch(() => {});
    fetch("/api/facets")
      .then((r) => r.json())
      .then((d: { facets: Facet[] }) => setFacets(d.facets))
      .catch(() => {});
  }, []);

  const save = async () => {
    await fetch("/api/prefs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ steer, avoid }),
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

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
      setNote(d.generated ? `dreamed from "${f.label}" → see dreams tab` : "couldn't generate");
    } catch {
      setNote("couldn't generate");
    } finally {
      setDreaming(null);
    }
  };

  return (
    <div className="tune">
      <h2>steer your dreams</h2>
      <p className="sub">
        a direction injected into every generated image. e.g. &ldquo;more
        cinematic, muted palettes, lots of negative space, no people&rdquo;.
      </p>
      <textarea
        value={steer}
        onChange={(e) => setSteer(e.target.value)}
        placeholder="the direction you want generations to lean…"
      />

      <h2>avoid</h2>
      <p className="sub">things to never generate — colors, subjects, styles.</p>
      <textarea
        value={avoid}
        onChange={(e) => setAvoid(e.target.value)}
        placeholder="e.g. neon, clutter, faces, oversaturation…"
      />

      <div>
        <button className="save" onClick={save}>
          save
        </button>
        {saved && <span className="saved">saved ✓</span>}
      </div>

      {facets.length > 0 && (
        <>
          <h2>dream from a facet</h2>
          <p className="sub">generate a new image from one of your taste clusters.</p>
          <div className="facet-dreams">
            {facets.map((f) => (
              <button
                key={f.id}
                className="chip"
                disabled={dreaming === f.id}
                onClick={() => dreamFrom(f)}
              >
                {dreaming === f.id ? "dreaming…" : f.label}
              </button>
            ))}
          </div>
          {note && <p className="sub" style={{ marginTop: "0.8rem" }}>{note}</p>}
        </>
      )}
    </div>
  );
}
