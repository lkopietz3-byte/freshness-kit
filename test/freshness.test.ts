import { describe, expect, it } from 'vitest'
import {
  ageInDays,
  assessFreshness,
  checkDatasetFreshness,
  freshnessBadgeText,
} from '../src/index.js'
import type { FreshnessConfig, FreshnessRecord } from '../src/index.js'

// A fixed "now" makes every test deterministic regardless of when the suite
// actually runs. All reviewedOn dates below are expressed relative to it.
const NOW = new Date('2026-08-02T12:00:00Z')
const CONFIG: FreshnessConfig = { warnAfterDays: 14, staleAfterDays: 45 }

function daysAgo(n: number): string {
  return new Date(NOW.getTime() - n * 86_400_000).toISOString().slice(0, 10)
}

describe('ageInDays', () => {
  it('is 0 for a reviewedOn date of today', () => {
    expect(ageInDays(daysAgo(0), NOW)).toBe(0)
  })

  it('floors to whole days rather than rounding up', () => {
    // 10 days and 12 hours before NOW should floor to 10, not round to 11.
    const reviewedOn = new Date(NOW.getTime() - 10 * 86_400_000 - 12 * 3_600_000)
      .toISOString()
      .slice(0, 10)
    expect(ageInDays(reviewedOn, NOW)).toBe(10)
  })

  it('never returns negative, even for a reviewedOn date in the future', () => {
    expect(ageInDays(daysAgo(-5), NOW)).toBe(0)
  })

  it('is UTC-safe for a bare YYYY-MM-DD date', () => {
    expect(ageInDays('2026-08-02', NOW)).toBe(0)
    expect(ageInDays('2026-07-19', NOW)).toBe(14)
  })
})

describe('assessFreshness boundaries', () => {
  it('is fresh exactly at warnAfterDays', () => {
    const result = assessFreshness(daysAgo(14), CONFIG, undefined, NOW)
    expect(result.level).toBe('fresh')
    expect(result.ageDays).toBe(14)
    expect(result.message).toBe('')
  })

  it('becomes aging one day past warnAfterDays', () => {
    const result = assessFreshness(daysAgo(15), CONFIG, undefined, NOW)
    expect(result.level).toBe('aging')
    expect(result.ageDays).toBe(15)
    expect(result.message).not.toBe('')
  })

  it('is still aging exactly at staleAfterDays', () => {
    const result = assessFreshness(daysAgo(45), CONFIG, undefined, NOW)
    expect(result.level).toBe('aging')
    expect(result.ageDays).toBe(45)
  })

  it('becomes stale one day past staleAfterDays', () => {
    const result = assessFreshness(daysAgo(46), CONFIG, undefined, NOW)
    expect(result.level).toBe('stale')
    expect(result.ageDays).toBe(46)
    expect(result.message).not.toBe('')
  })
})

describe('assessFreshness message overrides', () => {
  it('uses a caller-supplied message function instead of the default', () => {
    const result = assessFreshness(
      daysAgo(46),
      CONFIG,
      { stale: (ageDays, reviewedOn) => `CUSTOM stale ${ageDays} ${reviewedOn}` },
      NOW,
    )
    expect(result.message).toBe(`CUSTOM stale 46 ${daysAgo(46)}`)
  })

  it('falls back to the generic default for a level with no override supplied', () => {
    const result = assessFreshness(
      daysAgo(15),
      CONFIG,
      { stale: () => 'should not be used, this record is only aging' },
      NOW,
    )
    expect(result.level).toBe('aging')
    expect(result.message).toContain('15 days ago')
  })
})

describe('checkDatasetFreshness', () => {
  it('rolls up to the worst level across a mixed set and keeps every per-record result', () => {
    const records: FreshnessRecord[] = [
      { id: 'a', reviewedOn: daysAgo(0) }, // fresh
      { id: 'b', reviewedOn: daysAgo(20) }, // aging
      { id: 'c', reviewedOn: daysAgo(90) }, // stale, and the oldest overall
      { id: 'd', reviewedOn: daysAgo(50) }, // stale, but not the oldest
    ]

    const dataset = checkDatasetFreshness(records, CONFIG, undefined, NOW)

    expect(dataset.level).toBe('stale')
    expect(dataset.oldest?.id).toBe('c')
    expect(dataset.oldest?.result.ageDays).toBe(90)
    expect(dataset.records).toHaveLength(4)
    expect(dataset.records.map((r) => r.result.level)).toEqual(['fresh', 'aging', 'stale', 'stale'])
  })

  it('returns fresh with no oldest record for an empty dataset', () => {
    const dataset = checkDatasetFreshness([], CONFIG, undefined, NOW)
    expect(dataset.level).toBe('fresh')
    expect(dataset.oldest).toBeUndefined()
    expect(dataset.records).toEqual([])
  })

  it('is fresh when every record is fresh', () => {
    const records: FreshnessRecord[] = [
      { id: 'a', reviewedOn: daysAgo(0) },
      { id: 'b', reviewedOn: daysAgo(5) },
    ]
    const dataset = checkDatasetFreshness(records, CONFIG, undefined, NOW)
    expect(dataset.level).toBe('fresh')
    expect(dataset.oldest?.id).toBe('b')
  })
})

describe('freshnessBadgeText', () => {
  it('is empty for fresh, matching the empty message', () => {
    expect(freshnessBadgeText(assessFreshness(daysAgo(0), CONFIG, undefined, NOW))).toBe('')
  })

  it('mentions the age for aging and stale', () => {
    expect(freshnessBadgeText(assessFreshness(daysAgo(20), CONFIG, undefined, NOW))).toContain('20d')
    expect(freshnessBadgeText(assessFreshness(daysAgo(90), CONFIG, undefined, NOW))).toContain('90d')
  })
})
