// Guided strategist — pure types + input assembly + a dependency-free inputs
// hash. No server-only / Supabase / crypto imports so both the API routes and
// the client guide page can import the types.

export type BusinessProfile = {
  product: string
  valueProp: string
  icp: string
  stage: string
  primaryGoal: string
  skills: string
  channels: string
  constraints: string
  url: string
}

export const EMPTY_PROFILE: BusinessProfile = {
  product: '',
  valueProp: '',
  icp: '',
  stage: '',
  primaryGoal: '',
  skills: '',
  channels: '',
  constraints: '',
  url: '',
}

export type StrategyRoadmap = {
  thirty: string[]
  sixty: string[]
  ninety: string[]
}

export type StrategyAction = { action: string; why: string }
export type StrategyChannel = { channel: string; why: string }

export type StrategyBrief = {
  positioning: string
  icp: string
  messaging: string[]
  distribution: StrategyChannel[]
  roadmap: StrategyRoadmap
  nextActions: StrategyAction[]
  /** Canonical opportunity topics the plan targets — the guide links these
   *  into Signals so the user can act on them immediately. */
  targetOpportunities: string[]
}

export const STRATEGY_PROMPT_VERSION = 'strategy-v1'

/** Normalize a raw object into a complete BusinessProfile (string fields). */
export function normalizeProfile(raw: unknown): BusinessProfile {
  const o = (raw ?? {}) as Record<string, unknown>
  const s = (k: keyof BusinessProfile): string =>
    typeof o[k] === 'string' ? (o[k] as string).trim().slice(0, 2000) : ''
  return {
    product: s('product'),
    valueProp: s('valueProp'),
    icp: s('icp'),
    stage: s('stage'),
    primaryGoal: s('primaryGoal'),
    skills: s('skills'),
    channels: s('channels'),
    constraints: s('constraints'),
    url: s('url'),
  }
}

export function profileIsEmpty(p: BusinessProfile): boolean {
  return Object.values(p).every((v) => v.trim() === '')
}

/** Render the profile as a compact labeled block for the synthesis prompt. */
export function renderProfile(p: BusinessProfile): string {
  const rows: Array<[string, string]> = [
    ['Product', p.product],
    ['Value proposition', p.valueProp],
    ['Ideal customer (ICP)', p.icp],
    ['Stage', p.stage],
    ['Primary goal', p.primaryGoal],
    ['Founder skills / assets', p.skills],
    ['Distribution channels', p.channels],
    ['Constraints', p.constraints],
    ['URL', p.url],
  ]
  return rows
    .filter(([, v]) => v.trim().length > 0)
    .map(([label, v]) => `${label}: ${v}`)
    .join('\n')
}

/**
 * Assemble the full strategist input: the founder's profile followed by the
 * aggregated market intelligence (the same rendered block the Insights
 * synthesis uses). The model grounds its plan in both.
 */
export function assembleStrategyInput(profile: BusinessProfile, intelligenceText: string): string {
  return (
    `# THE FOUNDER\n${renderProfile(profile) || '(no profile provided)'}\n\n` +
    `# MARKET INTELLIGENCE (from their watched subreddits)\n${intelligenceText}\n\n` +
    `Write a grounded go-to-market plan for THIS founder against THIS market. ` +
    `Reference specific opportunities, tools, and momentum from the intelligence. ` +
    `Tailor positioning + roadmap to their stated skills, channels, and constraints.`
  )
}

/**
 * Dependency-free deterministic hash (djb2 → base36). Used to fingerprint the
 * exact inputs of a strategy run so identical re-runs are traceable.
 */
export function inputsHash(input: string): string {
  let h = 5381
  for (let i = 0; i < input.length; i++) {
    h = ((h << 5) + h + input.charCodeAt(i)) >>> 0
  }
  return h.toString(36)
}
