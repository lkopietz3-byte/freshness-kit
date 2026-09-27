import { describe, expect, it } from 'vitest'
import { ageInDays, assessFreshness, checkDatasetFreshness } from '../src/index.js'

const CONFIG = { warnAfterDays: 14, staleAfterDays: 45 }

// UTC+14:00 (for example Pacific/Kiritimati) is the furthest-ahead civil time
// zone. A bare date is a calendar day with no zone, so it is "in the future"
// only when it is later than today in every zone on Earth: when the clock
// reads 10:00:00Z on Sep 24 it is already 00:00 on Sep 25 in UTC+14.
describe('a bare date that is today somewhere on Earth is not a future date', () => {
  const sep25InKiritimati = new Date('2026-09-24T10:00:00.000Z')
  const oneMsEarlier = new Date('2026-09-24T09:59:59.999Z')

  it('is accepted, at age zero, the moment that calendar day begins in UTC+14', () => {
    expect(ageInDays('2026-09-25', sep25InKiritimati)).toBe(0)
  })

  it('is still rejected one millisecond before that moment', () => {
    expect(() => ageInDays('2026-09-25', oneMsEarlier)).toThrow(RangeError)
  })

  it('lets a reviewer in Tokyo enter their local date at 08:00 (23:00Z the day before)', () => {
    const tokyoMorning = new Date('2026-09-24T23:00:00Z')
    expect(ageInDays('2026-09-25', tokyoMorning)).toBe(0)
    expect(assessFreshness('2026-09-25', CONFIG, undefined, tokyoMorning).level).toBe('fresh')
  })

  it('does not fail a whole dataset run because one row carries the local date of a zone ahead of UTC', () => {
    const sydneyMorning = new Date('2026-09-24T21:00:00Z') // 07:00 on Sep 25 in Sydney
    const dataset = checkDatasetFreshness(
      [
        { id: 'today-in-sydney', reviewedOn: '2026-09-25' },
        { id: 'older', reviewedOn: '2026-09-01' },
      ],
      CONFIG,
      undefined,
      sydneyMorning,
    )
    expect(dataset.records.map((r) => r.result.ageDays)).toEqual([0, 23])
  })

  it('still rejects a bare date that is later than today in every time zone', () => {
    expect(() => ageInDays('2026-09-26', sep25InKiritimati)).toThrow(RangeError)
    expect(() => ageInDays('2062-06-01', sep25InKiritimati)).toThrow(RangeError)
  })

  it('never reports a negative age', () => {
    expect(ageInDays('2026-09-25', new Date('2026-09-24T12:00:00Z'))).toBe(0)
  })
})

describe('a timestamp is an exact instant and gets no such allowance', () => {
  it('is rejected when it is even one millisecond after now', () => {
    const now = new Date('2026-09-24T23:00:00.000Z')
    expect(ageInDays('2026-09-24T23:00:00.000Z', now)).toBe(0)
    expect(() => ageInDays('2026-09-24T23:00:00.001Z', now)).toThrow(RangeError)
  })

  it('is rejected even when it falls on a day that already began in UTC+14', () => {
    expect(() => ageInDays('2026-09-25T00:00:00Z', new Date('2026-09-24T12:00:00Z'))).toThrow(RangeError)
  })
})
