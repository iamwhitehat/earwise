import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { NavBar } from "./_components/nav-bar";
import { ScanProvider } from "./_components/scan-provider";
import { SidebarBackdrop, SidebarProvider } from "./_components/sidebar-provider";

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
    >
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
