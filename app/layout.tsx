import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import "./earwise-theme.css"; // earwise Signal-direction overrides — must come AFTER globals.css
import { AppShell } from "./_components/app-shell";

// Inline pre-paint script: applies the saved theme to <html> BEFORE React
// hydrates so the page never flashes the wrong theme. earwise is dark-first —
// default to dark unless the user has explicitly chosen light. Kept in a string
// so the layout stays a Server Component.
const THEME_INIT_SCRIPT = `(function(){try{var t=localStorage.getItem('reddit-reader:theme');if(t!=='light'){document.documentElement.setAttribute('data-theme','dark');}}catch(e){document.documentElement.setAttribute('data-theme','dark');}})();`;

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "earwise",
  description: "Demand intelligence for founders. Find what the market is broadcasting — and the opening you can win.",
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
      </body>
    </html>
  );
}
