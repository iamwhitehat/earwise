import type { Metadata } from 'next'
import { FAQS } from './faqs'

// Server layout wrapping the client marketing page — client pages can't export
// `metadata`, so page-specific SEO + JSON-LD live here.
export const metadata: Metadata = {
  title: { absolute: 'earwise — find buyers on Reddit and reply in your voice' },
  description:
    'earwise scans Reddit for people actively looking to buy what you sell, and drafts a reply in your voice. Free instant scan, no signup.',
  alternates: { canonical: '/site' },
  openGraph: {
    title: 'earwise — find buyers on Reddit and reply in your voice',
    description: "See who's asking to buy what you sell, right now. Free scan, no signup.",
    url: '/site',
    type: 'website',
  },
}

const faqJsonLd = {
  '@context': 'https://schema.org',
  '@type': 'FAQPage',
  mainEntity: FAQS.map((f) => ({
    '@type': 'Question',
    name: f.q,
    acceptedAnswer: { '@type': 'Answer', text: f.a },
  })),
}

const appJsonLd = {
  '@context': 'https://schema.org',
  '@type': 'SoftwareApplication',
  name: 'earwise',
  applicationCategory: 'BusinessApplication',
  operatingSystem: 'Web',
  description:
    'Demand intelligence for founders — find buyers on Reddit, Hacker News & StackOverflow and draft a reply in your voice.',
  offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
  url: 'https://earwise.io/site',
}

export default function SiteLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(appJsonLd) }} />
      {children}
    </>
  )
}
