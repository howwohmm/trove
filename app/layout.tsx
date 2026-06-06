import type { Metadata } from "next";
import { Geist } from "next/font/google";
import Link from "next/link";
import "./globals.css";

const geist = Geist({
  variable: "--font-geist",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "trove",
  description: "swipe to curate your own taste",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${geist.variable} h-full`}>
      <body className="min-h-full">
        <header className="topbar">
          <Link href="/" className="brand">
            trove
          </Link>
          <nav className="nav">
            <Link href="/">swipe</Link>
            <Link href="/library">library</Link>
            <Link href="/dreams">dreams</Link>
            <Link href="/tune">tune</Link>
            <Link href="/status">status</Link>
          </nav>
        </header>
        <main>{children}</main>
      </body>
    </html>
  );
}
