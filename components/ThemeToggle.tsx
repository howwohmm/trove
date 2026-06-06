"use client";

import { useEffect, useState } from "react";

type Theme = "light" | "dark";

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>("dark");

  useEffect(() => {
    setTheme((document.documentElement.dataset.theme as Theme) || "dark");
  }, []);

  const toggle = () => {
    const next: Theme = theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem("trove-theme", next);
    } catch {
      /* ignore */
    }
    setTheme(next);
  };

  return (
    <button className="theme-toggle" onClick={toggle} aria-label="toggle light/dark">
      {theme === "dark" ? "☀" : "☾"}
    </button>
  );
}
