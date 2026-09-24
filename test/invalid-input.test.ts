import { describe, expect, it } from 'vitest'
import { ageInDays, assessFreshness, checkDatasetFreshness, freshnessBadgeText } from '../src/index.js'

const NOW = new Date('2026-08-02T12:00:00Z')
const CONFIG = { warnAfterDays: 14, staleAfterDays: 45 }

describe('invalid dates cannot become a silent freshness result', () => {
  it.each([
    '', 'not-a-date', '2026-02-29', '2026-04-31', '2026-00-01', '2026-13-01',
    '2026-08-03', '2026-08-02T12:00:00.001Z', '2026-08-02T07:00:01-05:00',
    '2026-02-30T00:00:00Z', '2026-02-30T00:00:00-05:00',
    '08/02/2026', '2026-08-02T11:00:00', '2026-08-01T24:00:00Z',
    '2026-08-01T11:60:00Z', '2026-08-01T11:00:60Z', '2026-08-01T00:00:00+24:00',
    ' 2026-08-02 ', '2026-08-02\n', '2026-08-01T12:00:00.1234Z',
  ])('rejects %j through age, assessment, badge composition and mixed datasets', (date) => {
    expect(() => ageInDays(date, NOW)).toThrow(RangeError)
    expect(() => assessFreshness(date, CONFIG, undefined, NOW)).toThrow(RangeError)
    expect(() => freshnessBadgeText(assessFreshness(date, CONFIG, undefined, NOW))).toThrow(RangeError)
    for (const dates of [[date, '2026-05-01'], ['2026-08-01', date]]) {
      expect(() => checkDatasetFreshness(dates.map((reviewedOn, i) => ({ id: String(i), reviewedOn })), CONFIG, undefined, NOW)).toThrow(RangeError)
    }
  })

  it.each(['2026-08-02T12:00:00Z', '2026-08-02T07:00:00-05:00', '2026-08-03T02:00:00+14:00'])('compares explicit offsets by instant: %s', (date) => {
    expect(ageInDays(date, NOW)).toBe(0)
    expect(assessFreshness(date, CONFIG, undefined, NOW).level).toBe('fresh')
  })

  it('accepts real leap days and rejects century rollover', () => {
    expect(ageInDays('2024-02-29', NOW)).toBe(885)
    expect(ageInDays('2000-02-29', NOW)).toBeGreaterThan(0)
    expect(() => ageInDays('1900-02-29', NOW)).toThrow(RangeError)
  })

  it.each(['1', '12', '123'])('accepts %s fractional-second digits on a past instant', (fraction) => {
    expect(assessFreshness(`2026-08-02T11:59:59.${fraction}Z`, CONFIG, undefined, NOW).ageDays).toBe(0)
  })

  it('rejects an invalid clock for every date API, including empty datasets', () => {
    const now = new Date(NaN)
    expect(() => ageInDays('2026-08-02', now)).toThrow(RangeError)
    expect(() => assessFreshness('2026-08-02', CONFIG, undefined, now)).toThrow(RangeError)
    expect(() => checkDatasetFreshness([], CONFIG, undefined, now)).toThrow(RangeError)
  })

  it.each([
    { warnAfterDays: NaN, staleAfterDays: 45 },
    { warnAfterDays: 14, staleAfterDays: Infinity },
    { warnAfterDays: -1, staleAfterDays: 45 },
    { warnAfterDays: 0, staleAfterDays: -1 },
    { warnAfterDays: 0.5, staleAfterDays: 45 },
    { warnAfterDays: 0, staleAfterDays: 45.5 },
    { warnAfterDays: 45, staleAfterDays: 14 },
  ])('rejects thresholds that cannot classify reliably: %j', (config) => {
    expect(() => assessFreshness('2026-08-02', config, undefined, NOW)).toThrow(RangeError)
    expect(() => checkDatasetFreshness([], config, undefined, NOW)).toThrow(RangeError)
  })

  it('accepts zero and equal thresholds with unchanged inclusive boundaries', () => {
    const config = { warnAfterDays: 0, staleAfterDays: 0 }
    expect(assessFreshness('2026-08-02', config, undefined, NOW).level).toBe('fresh')
    expect(assessFreshness('2026-08-01', config, undefined, NOW).level).toBe('stale')
  })
})
