import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { NavBar } from "./_components/nav-bar";
import { ScanProvider } from "./_components/scan-provider";
import { SidebarBackdrop, SidebarProvider } from "./_components/sidebar-provider";

// Inline pre-paint script: applies the saved theme (or the OS preference if
// the user hasn't picked one) to <html> BEFORE React hydrates, so the page
// never paints a light-mode flash on top of a dark-mode preference. Kept in
// a string so the layout stays a Server Component.
const THEME_INIT_SCRIPT = `(function(){try{var t=localStorage.getItem('reddit-reader:theme');if(t==='dark'||(t==null&&window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches)){document.documentElement.setAttribute('data-theme','dark');}}catch(e){}})();`;

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "RedditRadar",
  description: "Reddit signal — trends and opportunity scores across watched subs",
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
        <ScanProvider>
          <SidebarProvider>
            <div className="app">
              <NavBar />
              <SidebarBackdrop />
              <main className="main scroll">{children}</main>
            </div>
          </SidebarProvider>
        </ScanProvider>
      </body>
    </html>
  );
}
