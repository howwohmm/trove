import type { Metadata } from "next";
import { Geist } from "next/font/google";
import Link from "next/link";
import "./globals.css";
import { ThemeToggle } from "@/components/ThemeToggle";

const geist = Geist({
  variable: "--font-geist",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "trove",
  description: "swipe to curate your own taste",
};

// runs before paint → no flash of the wrong theme
const themeScript = `(function(){try{var t=localStorage.getItem('trove-theme');if(!t){t=window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';}document.documentElement.dataset.theme=t;}catch(e){document.documentElement.dataset.theme='dark';}})();`;

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${geist.variable} h-full`} suppressHydrationWarning>
      <body className="min-h-full">
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
        <header className="topbar">
          <Link href="/" className="brand">
            trove<span className="brand-dot" />
          </Link>
          <nav className="nav">
            <Link href="/">swipe</Link>
            <Link href="/library">library</Link>
            <Link href="/dreams">dreams</Link>
            <Link href="/tune">tune</Link>
            <Link href="/status">status</Link>
            <ThemeToggle />
          </nav>
        </header>
        <main>{children}</main>
      </body>
    </html>
  );
}
