import type { Metadata } from 'next'

// Server layout for the standalone free-scan page (client component) — carries
// its page-specific metadata.
export const metadata: Metadata = {
  title: 'Free Reddit buyer scan',
  description:
    "Type your niche and instantly see who's asking to buy what you sell on Reddit — with a reply drafted in your voice. Free, no signup.",
  alternates: { canonical: '/scan' },
  openGraph: {
    title: 'Free Reddit buyer scan · earwise',
    description: "See who's asking to buy what you sell on Reddit, right now. Free, no signup.",
    url: '/scan',
    type: 'website',
  },
}

export default function ScanLayout({ children }: { children: React.ReactNode }) {
  return children
}
