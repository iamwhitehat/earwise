import type { MetadataRoute } from 'next'

const BASE = 'https://earwise.io'

// Public, indexable surfaces only. The app itself (/today, /signals, …) is behind
// auth and intentionally excluded.
export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: `${BASE}/site`, changeFrequency: 'weekly', priority: 1 },
    { url: `${BASE}/scan`, changeFrequency: 'weekly', priority: 0.9 },
    { url: `${BASE}/login`, changeFrequency: 'monthly', priority: 0.5 },
  ]
}
