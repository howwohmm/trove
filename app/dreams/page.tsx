"use client";

import { useCallback, useEffect, useState } from "react";
import { Masonry, type MasonryItem } from "@/components/Masonry";

export function DreamsPage() {
  const [items, setItems] = useState<MasonryItem[]>([]);
  const [dreaming, setDreaming] = useState(false);

  const refetch = useCallback(() => {
    fetch("/api/dreams")
      .then((r) => r.json())
      .then((d: { items: MasonryItem[] }) => setItems(d.items))
      .catch(() => {});
  }, []);

  useEffect(() => {
    refetch();
  }, [refetch]);

  const dream = useCallback(async () => {
    if (dreaming) return;
    setDreaming(true);
    try {
      await fetch("/api/dreams/generate", { method: "POST", body: JSON.stringify({}) });
      refetch();
    } finally {
      setDreaming(false);
    }
  }, [dreaming, refetch]);

  return (
    <main className="page">
      <div style={{ display: "flex", alignItems: "baseline", gap: "1rem", marginBottom: "1.2rem", flexWrap: "wrap" }}>
        <h1 style={{ fontSize: "1.1rem" }}>dreams</h1>
        <button className="chip" onClick={dream} disabled={dreaming} style={{ cursor: dreaming ? "wait" : "pointer" }}>
          {dreaming ? "dreaming…" : "dream from your taste"}
        </button>
        <span className="small muted">
          {items.length} generated in your taste · kept dreams never touch retrieval taste
        </span>
      </div>
      <Masonry items={items} />
    </main>
  );
}

export default DreamsPage;
