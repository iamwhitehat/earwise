// Pure type definitions shared by the server synthesis (lib/claude.ts) and the
// client renderer (app/insights/page.tsx + app/language/page.tsx). Kept free of
// any server-only / Supabase imports so both sides can import the types.

export type Confidence = 'high' | 'medium' | 'low'

export type InsightDemand = {
  posts: number
  uniqueAuthors: number
  engagement: number
}

export type InsightEvidence = {
  quote: string
  permalink: string
}

/** Decision-grade insight (Insights v2). One per top canonical opportunity. */
export type InsightV2 = {
  title: string
  audience: string
  problem: string
  demand: InsightDemand
  momentum: string
  whatToBuild: string
  whyNow: string
  evidence: InsightEvidence[]
  confidence: Confidence
}

// ─── Customer Voice v2 (messaging) ────────────────────────────────────────────

/** A generated copy asset annotated with the verbatim source quotes it draws on. */
export type MessagingAsset = {
  text: string
  sources: string[]
}

export type MessagingTheme = {
  theme: string
  summary: string
  sources: string[]
}

export type MessagingObjection = {
  objection: string
  response: string
}

export type MessagingAssets = {
  themes: MessagingTheme[]
  headlines: MessagingAsset[]
  landingHero: { headline: string; subhead: string; sources: string[] }
  coldOpeners: MessagingAsset[]
  adAngles: MessagingAsset[]
  objections: MessagingObjection[]
  switchingTriggers: string[]
  willingnessToPay: string
}
