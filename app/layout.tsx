import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Nav } from "@/components/Nav";

export const metadata: Metadata = {
  title: "trove",
  description: "a personal taste engine — swipe, keep, learn",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  themeColor: "#262626",
};

export function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Manrope:wght@300;400&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <Nav />
        {children}
      </body>
    </html>
  );
}

export default RootLayout;
