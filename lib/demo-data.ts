// Demo workspace seed data (Phase 8). A preloaded sample niche so a brand-new
// visitor sees a fully populated app — opportunities, leads, customer outcomes —
// before doing any setup. Pure data; the seeding lives in lib/demo-db.ts.
import type { BusinessProfile } from './strategy'
import type { AdvantageComponents } from './advantage'

export const DEMO_PROJECT_ID = 'demo'
export const DEMO_PROJECT = {
  id: DEMO_PROJECT_ID,
  name: 'Demo · AI support tools',
  niche: 'AI customer support tools',
}

export const DEMO_PROFILE: BusinessProfile = {
  product: 'An AI layer that triages and drafts replies for customer-support teams',
  valueProp: 'Cut first-response time in half without losing the human touch',
  icp: 'Seed–Series B SaaS support leads drowning in ticket volume',
  stage: 'MVP with 5 design partners',
  primaryGoal: 'Find 20 qualified design partners this quarter',
  skills: 'NLP, support ops, B2B SaaS GTM',
  channels: 'Reddit, founder communities, cold outreach',
  constraints: 'Solo founder, limited eng time',
  url: 'https://example.com',
}

export const DEMO_LEARNED_FACTS: string[] = [
  'Recommendation-style openers convert best with support leads.',
  'Mentioning a specific tool they already use (Zendesk, Intercom) lifts reply rate.',
]

export type DemoOpportunity = {
  topic: string
  components: AdvantageComponents
  confirmedSources: string[]
  posts: number
  subreddits: string[]
}

export const DEMO_OPPORTUNITIES: DemoOpportunity[] = [
  {
    topic: 'AI ticket triage & routing',
    components: { demand: 0.82, monetization: 0.7, momentum: 0.78, whitespace: 0.55, fitToYou: 0.72 },
    confirmedSources: ['reddit', 'hackernews'],
    posts: 48,
    subreddits: ['SaaS', 'startups', 'CustomerSuccess'],
  },
  {
    topic: 'Hallucination guardrails for support bots',
    components: { demand: 0.6, monetization: 0.55, momentum: 0.9, whitespace: 0.7, fitToYou: 0.6 },
    confirmedSources: ['reddit', 'stackoverflow'],
    posts: 31,
    subreddits: ['MachineLearning', 'LangChain', 'SaaS'],
  },
  {
    topic: 'Self-serve help-center analytics',
    components: { demand: 0.65, monetization: 0.6, momentum: 0.5, whitespace: 0.6, fitToYou: 0.52 },
    confirmedSources: ['reddit'],
    posts: 27,
    subreddits: ['CustomerSuccess', 'SaaS'],
  },
  {
    topic: 'Multilingual support automation',
    components: { demand: 0.5, monetization: 0.65, momentum: 0.6, whitespace: 0.75, fitToYou: 0.45 },
    confirmedSources: ['reddit', 'hackernews'],
    posts: 22,
    subreddits: ['startups', 'SaaS', 'ecommerce'],
  },
]

export type DemoLead = {
  kind: 'post' | 'comment'
  external_id: string
  post_id: string
  subreddit: string
  permalink: string
  author: string
  topic: string
  intent_type: string
  category: string
  excerpt: string
  opener_draft: string | null
  status: 'new' | 'contacted' | 'replied' | 'call' | 'customer' | 'passed'
}

export const DEMO_LEADS: DemoLead[] = [
  {
    kind: 'post',
    external_id: 'demo:post:t3_triage1',
    post_id: 't3_triage1',
    subreddit: 'SaaS',
    permalink: 'https://www.reddit.com/r/SaaS/comments/t3_triage1/',
    author: 'supportlead',
    topic: 'AI ticket triage & routing',
    intent_type: 'recommendation',
    category: 'pain_point',
    excerpt: 'Our Zendesk queue is drowning — looking for something that auto-triages tickets by urgency so my team stops cherry-picking the easy ones.',
    opener_draft: null,
    status: 'new',
  },
  {
    kind: 'comment',
    external_id: 'demo:comment:t1_guardrail1',
    post_id: 't3_guardrailthread',
    subreddit: 'CustomerSuccess',
    permalink: 'https://www.reddit.com/r/CustomerSuccess/comments/t3_guardrailthread/t1_guardrail1/',
    author: 'cx_ops',
    topic: 'Hallucination guardrails for support bots',
    intent_type: 'pain',
    category: 'tool_complaint',
    excerpt: 'We tried a support bot but it hallucinated our refund policy to a customer. Need real guardrails before we trust it again.',
    opener_draft:
      'Saw your note about the bot inventing a refund policy — that trust gap is brutal, especially once a customer screenshots it. Out of curiosity, was it making up policy or just pulling the wrong doc?',
    status: 'contacted',
  },
  {
    kind: 'post',
    external_id: 'demo:post:t3_analytics1',
    post_id: 't3_analytics1',
    subreddit: 'startups',
    permalink: 'https://www.reddit.com/r/startups/comments/t3_analytics1/',
    author: 'founderx',
    topic: 'Self-serve help-center analytics',
    intent_type: 'would_pay',
    category: 'feature_request',
    excerpt: 'I would happily pay for something that tells me WHY tickets spike each week, not just the raw counts my helpdesk shows.',
    opener_draft: null,
    status: 'replied',
  },
]

export type DemoEvent = {
  entity: 'lead' | 'opportunity'
  entityId: string
  kind: string
  payload: Record<string, unknown>
}

export const DEMO_EVENTS: DemoEvent[] = [
  { entity: 'lead', entityId: 'demo-1', kind: 'draft_sent', payload: { intentType: 'recommendation', topic: 'AI ticket triage & routing', subreddit: 'SaaS' } },
  { entity: 'lead', entityId: 'demo-1', kind: 'reply', payload: { intentType: 'recommendation', topic: 'AI ticket triage & routing', subreddit: 'SaaS' } },
  { entity: 'lead', entityId: 'demo-1', kind: 'conversion', payload: { intentType: 'recommendation', topic: 'AI ticket triage & routing', subreddit: 'SaaS' } },
  { entity: 'lead', entityId: 'demo-2', kind: 'draft_sent', payload: { intentType: 'pain', topic: 'Hallucination guardrails for support bots', subreddit: 'CustomerSuccess' } },
  { entity: 'lead', entityId: 'demo-2', kind: 'reply', payload: { intentType: 'pain', topic: 'Hallucination guardrails for support bots', subreddit: 'CustomerSuccess' } },
  { entity: 'lead', entityId: 'demo-3', kind: 'draft_sent', payload: { intentType: 'would_pay', topic: 'Self-serve help-center analytics', subreddit: 'startups' } },
  { entity: 'opportunity', entityId: 'AI ticket triage & routing', kind: 'opportunity_pursued', payload: { topic: 'AI ticket triage & routing', components: DEMO_OPPORTUNITIES[0].components } },
  { entity: 'opportunity', entityId: 'Hallucination guardrails for support bots', kind: 'opportunity_pursued', payload: { topic: 'Hallucination guardrails for support bots', components: DEMO_OPPORTUNITIES[1].components } },
  { entity: 'opportunity', entityId: 'Multilingual support automation', kind: 'opportunity_parked', payload: { topic: 'Multilingual support automation', components: DEMO_OPPORTUNITIES[3].components } },
]
