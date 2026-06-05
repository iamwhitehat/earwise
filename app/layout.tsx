import type { Metadata } from "next";
import { Space_Grotesk, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import "./earwise-theme.css"; // earwise Signal-direction overrides — must come AFTER globals.css
import "./earwise-screens.css"; // new design-handoff screens (Warm Leads, …) — after the theme
import { AppShell } from "./_components/app-shell";
import { Analytics } from "@vercel/analytics/next";

// Inline pre-paint script: applies the saved theme to <html> BEFORE React
// hydrates so the page never flashes the wrong theme. earwise is dark-first —
// default to dark unless the user has explicitly chosen light. Kept in a string
// so the layout stays a Server Component.
const THEME_INIT_SCRIPT = `(function(){try{var t=localStorage.getItem('earwise:theme');if(t!=='light'){document.documentElement.setAttribute('data-theme','dark');}}catch(e){document.documentElement.setAttribute('data-theme','dark');}})();`;

// Earwise spec §4.2 type: Space Grotesk (display/body) + JetBrains Mono (data).
// Kept on the existing --font-geist-* variable names so every component that
// already references them adopts the new fonts with no per-file change.
const geistSans = Space_Grotesk({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = JetBrains_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL("https://earwise.io"),
  title: {
    default: "earwise — find buyers on Reddit and reply in your voice",
    template: "%s · earwise",
  },
  description:
    "earwise scans Reddit, Hacker News & StackOverflow for people actively looking to buy what you sell — and drafts a reply in your voice. Free first scan, no signup.",
  openGraph: {
    title: "earwise — find buyers on Reddit and reply in your voice",
    description:
      "See who's asking to buy what you sell, right now. Free scan, no signup — then a fresh batch of buyers every day.",
    url: "/",
    siteName: "earwise",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "earwise — find buyers on Reddit and reply in your voice",
    description: "See who's asking to buy what you sell, right now. Free scan, no signup.",
  },
  // TODO: add an og-image (1200×630) to /public and reference it here + in
  // openGraph.images / twitter.images once the asset exists.
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        <script
          // Server-rendered string — no user input, no XSS surface.
          dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }}
        />
      </head>
      <body>
        <AppShell>{children}</AppShell>
        <Analytics />
      </body>
    </html>
  );
}
