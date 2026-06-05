import { describe, it, expect } from 'vitest'
import { buildDailyTasks, allDone, dayKey, recordCompletion, type BuildInput } from './daily-brief'
import type { HotSignal } from './hot-signals'
import type { MaterializedOpportunity } from './advantage'
import { leadExternalId, type LeadStatus } from './leads'

const sig = (over: Partial<HotSignal>): HotSignal => ({
  kind: 'post', id: 'a', post_id: 'a', subreddit: 'sysadmin', author: 'alice',
  text: 'looking for a tool', matchedPhrase: 'looking for', intentType: 'looking-for',
  category: 'pain_point', topic: null, analyzedAt: 0, permalink: 'https://reddit.com/r/sysadmin/comments/a/',
  score: 90, tier: 'hot', breakdown: {} as HotSignal['breakdown'], ...over,
})

const opp = (topic: string): MaterializedOpportunity => ({
  topic, advantage: 0.9, demand: 1, monetization: 1, momentum: 1, whitespace: 1, fitToYou: 1,
  contributions: {} as MaterializedOpportunity['contributions'], confirmedSources: [], posts: 20, subreddits: ['msp'],
})

const base = (over: Partial<BuildInput>): BuildInput => ({
  hotSignals: [], topOpportunity: null, leadStatus: new Map(), localDone: new Set(), ...over,
})

describe('buildDailyTasks', () => {
  it('builds up to 3 reply tasks + a publish task', () => {
    const tasks = buildDailyTasks(base({
      hotSignals: [sig({ id: 'a' }), sig({ id: 'b' }), sig({ id: 'c' }), sig({ id: 'd' })],
      topOpportunity: opp('remote device enforcement'),
    }))
    expect(tasks.filter((t) => t.kind === 'reply')).toHaveLength(3) // capped at REPLY_TARGET
    expect(tasks.at(-1)).toMatchObject({ kind: 'publish', done: false })
  })

  it('marks a reply done when its lead has acted (contacted+), not when new/absent', () => {
    const leadStatus = new Map<string, LeadStatus>([
      [leadExternalId('post', 'a'), 'contacted'],
      [leadExternalId('post', 'b'), 'new'],
    ])
    const tasks = buildDailyTasks(base({ hotSignals: [sig({ id: 'a' }), sig({ id: 'b' }), sig({ id: 'c' })], leadStatus }))
    const byId = Object.fromEntries(tasks.map((t) => [t.id, t.done]))
    expect(byId[`reply:${leadExternalId('post', 'a')}`]).toBe(true)
    expect(byId[`reply:${leadExternalId('post', 'b')}`]).toBe(false) // new
    expect(byId[`reply:${leadExternalId('post', 'c')}`]).toBe(false) // no lead yet
  })

  it('drops a skipped (passed) signal from the list', () => {
    const leadStatus = new Map<string, LeadStatus>([[leadExternalId('post', 'a'), 'passed']])
    const tasks = buildDailyTasks(base({ hotSignals: [sig({ id: 'a' }), sig({ id: 'b' })], leadStatus }))
    expect(tasks.find((t) => t.id === `reply:${leadExternalId('post', 'a')}`)).toBeUndefined()
    expect(tasks).toHaveLength(1)
  })

  it('with no signals but an opportunity, shows only the publish task (localDone marks it done)', () => {
    const tasks = buildDailyTasks(base({ topOpportunity: opp('pricing'), localDone: new Set(['publish']) }))
    expect(tasks).toHaveLength(1)
    expect(tasks[0]).toMatchObject({ kind: 'publish', done: true })
  })

  it('never blank — falls back to a scan task', () => {
    const tasks = buildDailyTasks(base({}))
    expect(tasks).toHaveLength(1)
    expect(tasks[0].kind).toBe('scan')
  })
})

describe('allDone', () => {
  it('true only when every task is done and there is at least one', () => {
    expect(allDone([])).toBe(false)
    expect(allDone([{ id: 'x', kind: 'scan', title: '', meta: '', done: true }])).toBe(true)
    expect(allDone([{ id: 'x', kind: 'scan', title: '', meta: '', done: false }])).toBe(false)
  })
})

describe('recordCompletion / dayKey', () => {
  const D = (s: string) => Date.parse(`${s}T12:00:00.000Z`)
  it('dayKey is the UTC date', () => {
    expect(dayKey(D('2026-06-05'))).toBe('2026-06-05')
  })
  it('continues the streak on a consecutive day', () => {
    const prev = { streak: 6, lastCompletedDate: '2026-06-04' }
    expect(recordCompletion(prev, D('2026-06-05'))).toEqual({ streak: 7, lastCompletedDate: '2026-06-05' })
  })
  it('resets to 1 after a gap', () => {
    const prev = { streak: 6, lastCompletedDate: '2026-06-02' }
    expect(recordCompletion(prev, D('2026-06-05'))).toEqual({ streak: 1, lastCompletedDate: '2026-06-05' })
  })
  it('is idempotent within the same day', () => {
    const prev = { streak: 7, lastCompletedDate: '2026-06-05' }
    expect(recordCompletion(prev, D('2026-06-05'))).toBe(prev)
  })
  it('first ever completion starts at 1', () => {
    expect(recordCompletion({ streak: 0, lastCompletedDate: '' }, D('2026-06-05'))).toEqual({ streak: 1, lastCompletedDate: '2026-06-05' })
  })
})
