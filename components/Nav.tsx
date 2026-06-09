"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/", label: "swipe" },
  { href: "/library", label: "library" },
  { href: "/taste", label: "taste" },
  { href: "/dreams", label: "dreams" },
  { href: "/status", label: "status" },
];

export function Nav() {
  const path = usePathname();
  return (
    <nav className="nav">
      <span className="wordmark">trove</span>
      {LINKS.map((l) => (
        <Link key={l.href} href={l.href} className={path === l.href ? "active" : ""}>
          {l.label}
        </Link>
      ))}
    </nav>
  );
}
