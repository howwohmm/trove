import type { Metadata } from "next";
import { Manrope } from "next/font/google";
import Link from "next/link";
import "./globals.css";

const manrope = Manrope({
  variable: "--font-manrope",
  subsets: ["latin"],
  weight: ["200", "300", "400"],
});

export const metadata: Metadata = {
  title: "trove",
  description: "swipe to curate your own taste",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${manrope.variable} h-full`}>
      <body className="min-h-full">
        <header className="topbar">
          <Link href="/" className="brand">
            trove
          </Link>
          <nav className="nav">
            <Link href="/">swipe</Link>
            <Link href="/library">library</Link>
            <Link href="/dreams">dreams</Link>
          </nav>
        </header>
        <main>{children}</main>
      </body>
    </html>
  );
}
