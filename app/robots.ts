import type { MetadataRoute } from 'next'

// Allow the public marketing/funnel surfaces; keep the gated app + APIs out of
// the index.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: ['/site', '/scan', '/login'],
      disallow: ['/api/', '/today', '/signals', '/leads', '/insights', '/welcome', '/dashboard', '/explore'],
    },
    sitemap: 'https://earwise.io/sitemap.xml',
  }
}
