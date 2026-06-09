import Link from "next/link";

// footer-as-index (godly.studio pattern) + the negation manifesto line.
export function Footer() {
  return (
    <footer className="footer-index">
      <nav className="run">
        <Link href="/">swipe</Link>
        <span className="faint">/</span>
        <Link href="/library">library</Link>
        <span className="faint">/</span>
        <Link href="/taste">taste</Link>
        <span className="faint">/</span>
        <Link href="/dreams">dreams</Link>
        <span className="faint">/</span>
        <Link href="/status">status</Link>
      </nav>
      <p className="t-hint">local-first. no cloud. no one else&apos;s algorithm.</p>
    </footer>
  );
}
