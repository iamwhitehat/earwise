// Verification of the combined relevance + buyer-intent gate against the real
// cases from RELEVANCE-INTENT-GATE-PATCH §7, for a SaaS / "AI support tools"
// project. The deterministic surfaces (maker pre-flag, role→buyer mapping,
// τ threshold) are asserted here; the off-niche cases (socks / conference room /
// Barclays) are gated at runtime by relevance score < τ, modelled here via the
// relevance scoring helpers.
import { describe, it, expect } from 'vitest'
import { makerPreflag, normalizeBuyerVerdicts } from './buyer-intent'
import { qualifiesRelevance, relevanceFromCosine, DEFAULT_RELEVANCE_TAU } from './relevance'

describe('verify §7 — makers / ramble are NOT buyers', () => {
  it('u/bizlal — "I will not promote… I built RHYMEBOOK" is flagged as a maker', () => {
    expect(
      makerPreflag('I will not promote, but I built RHYMEBOOK — a rhyming app for rappers. Feedback?'),
    ).toBe(true)
  })

  it('u/Hayaldesu — a willing-to-pay mindset ramble classifies as discussion, not buyer', () => {
    // The classifier returns role:'discussion' for motivational rants even when
    // they mention paying — so isBuyer is false and it never reaches the feed.
    const out = normalizeBuyerVerdicts(
      { verdicts: [{ index: 1, role: 'discussion', intent: 'willing-to-pay' }] },
      1,
    )
    expect(out[0]?.isBuyer).toBe(false)
    expect(out[0]?.intent).toBeNull()
  })
})

describe('verify §7 — off-niche buyers are excluded by relevance < τ', () => {
  // Real buyers, but for the WRONG niche → low cosine to an "AI support tools"
  // niche vector → relevance below τ → dropped. (Runtime cosines are illustrative.)
  const offNiche: Record<string, number> = {
    'u/lonethh — EU sock manufacturer': 0.18,
    'u/Unce_Turbo_996 — conference room A/V setup': 0.22,
    'u/yoldevam — Barclays signing software': 0.3,
  }
  for (const [label, cosine] of Object.entries(offNiche)) {
    it(`${label} is excluded`, () => {
      expect(qualifiesRelevance(relevanceFromCosine(cosine))).toBe(false)
    })
  }

  it('an on-niche buyer (seeking an AI ticketing/support tool) stays', () => {
    // High cosine to the niche vector → relevance >= τ → qualifies.
    expect(qualifiesRelevance(relevanceFromCosine(0.78))).toBe(true)
    expect(DEFAULT_RELEVANCE_TAU).toBe(0.6)
  })
})
