"use client";

import { useCallback, useEffect, useState } from "react";
import type { Dream } from "@/lib/dreams";
import { DreamDeck } from "@/components/DreamDeck";

interface DreamData {
  dreams: Dream[];
  provider: string;
  hasProvider: boolean;
  enabled: boolean;
}

export default function DreamsPage() {
  const [data, setData] = useState<DreamData | null>(null);

  const refresh = useCallback(() => {
    fetch("/api/dreams")
      .then((r) => r.json())
      .then(setData)
      .catch(() => setData({ dreams: [], provider: "", hasProvider: false, enabled: false }));
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  if (!data) return <p className="hint">loading dreams…</p>;

  if (!data.enabled)
    return (
      <p className="hint">
        dreams are off. add <code>ANTHROPIC_API_KEY</code> to{" "}
        <code>.env.local</code> and restart — then keep a few images and trove
        starts generating in your taste.
      </p>
    );

  if (data.dreams.length === 0 && !data.hasProvider)
    return (
      <p className="hint">
        the taste brain is on, but no image generator is set. add{" "}
        <code>OPENROUTER_API_KEY</code> (recommended — nano banana 2) or{" "}
        <code>FAL_KEY</code> to <code>.env.local</code> and restart. then keep a
        few distinctive images and dreams appear here.
      </p>
    );

  const pending = data.dreams.filter((d) => !d.status || d.status === "pending");
  const kept = data.dreams.filter((d) => d.status === "kept");

  if (data.dreams.length === 0)
    return (
      <p className="hint">
        no dreams yet. keep more images — once enough distinctive aesthetics
        accumulate, trove generates new ones here. (gen: {data.provider})
      </p>
    );

  return (
    <>
      {pending.length > 0 && <DreamDeck pending={pending} onSwiped={refresh} />}

      <div className="lib">
        <p className="lib-head">
          {kept.length} bred · the dreams you kept · {data.provider}
        </p>
        {kept.length === 0 ? (
          <p className="hint" style={{ marginTop: "2rem" }}>
            judge the dreams above — the ones you keep land here and breed the
            next generation.
          </p>
        ) : (
          <div className="grid">
            {kept.map((d) => (
              <a
                key={d.id}
                className="tile"
                href={`/api/gen/${d.file}`}
                target="_blank"
                rel="noreferrer"
                title={d.prompt}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={`/api/gen/${d.file}`} alt={d.prompt} loading="lazy" />
              </a>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
