"use client";

import { useEffect, useState } from "react";
import { motion } from "motion/react";

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
    <motion.button
      className="theme-toggle"
      onClick={toggle}
      aria-label="toggle light/dark"
      whileTap={{ scale: 0.7, rotate: 180 }}
      whileHover={{ scale: 1.15 }}
      transition={{ type: "spring", stiffness: 500, damping: 12 }}
    >
      {theme === "dark" ? "☀" : "☾"}
    </motion.button>
  );
}
