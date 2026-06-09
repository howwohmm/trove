"use client";

import { useCallback, useEffect, useState } from "react";
import { Masonry, type MasonryItem } from "@/components/Masonry";
import { Footer } from "@/components/Footer";

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
      <div className="page-body">
        <div
          style={{ display: "flex", alignItems: "baseline", gap: "1rem", marginBottom: "1.2rem", flexWrap: "wrap" }}
        >
          <h1 className="t-title">dreams</h1>
          <button
            className={dreaming ? "chip breathing" : "chip"}
            onClick={dream}
            disabled={dreaming}
            style={{ cursor: dreaming ? "wait" : "pointer" }}
          >
            {dreaming ? "dreaming…" : "dream from your taste"}
          </button>
          <span className="t-hint">{items.length} dreams ✦ kept dreams never touch retrieval taste</span>
        </div>
        <Masonry items={items} developIn />
      </div>
      <Footer />
    </main>
  );
}

export default DreamsPage;
