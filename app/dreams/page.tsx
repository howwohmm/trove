"use client";

import { useEffect, useState } from "react";
import { Masonry, type MasonryItem } from "@/components/Masonry";

export function DreamsPage() {
  const [items, setItems] = useState<MasonryItem[]>([]);

  useEffect(() => {
    fetch("/api/dreams")
      .then((r) => r.json())
      .then((d: { items: MasonryItem[] }) => setItems(d.items))
      .catch(() => {});
  }, []);

  return (
    <main className="page">
      <div style={{ display: "flex", alignItems: "baseline", gap: "1rem", marginBottom: "1.2rem" }}>
        <h1 style={{ fontSize: "1.1rem" }}>dreams</h1>
        <span className="small muted">
          {items.length} generated in your taste · kept dreams never touch retrieval taste
        </span>
      </div>
      <Masonry items={items} />
    </main>
  );
}

export default DreamsPage;
