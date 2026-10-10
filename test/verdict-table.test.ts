import vm from 'node:vm'
import { describe, expect, it } from 'vitest'
import {
  ageInDays,
  assessFreshness,
  checkDatasetFreshness,
  freshnessBadgeText,
} from '../src/index.js'
import type { FreshnessConfig } from '../src/index.js'

// Verdict regression table. Each named case asserts the documented behavior
// for one finding; the guard cases pin the boundaries that must not move.
const NOW = new Date('2026-10-10T12:00:00Z')
const CONFIG: FreshnessConfig = { warnAfterDays: 14, staleAfterDays: 45 }

function daysAgo(n: number): string {
  return new Date(NOW.getTime() - n * 86_400_000).toISOString().slice(0, 10)
}

describe('default messages use correct grammar for the day count', () => {
  it('says "1 day ago", not "1 days ago", in the aging message', () => {
    const r = assessFreshness(daysAgo(1), { warnAfterDays: 0, staleAfterDays: 5 }, undefined, NOW)
    expect(r.level).toBe('aging')
    expect(r.message).toBe('This information was last checked 1 day ago.')
  })

  it('says "1 day ago", not "1 days ago", in the stale message', () => {
    const r = assessFreshness(daysAgo(1), { warnAfterDays: 0, staleAfterDays: 0 }, undefined, NOW)
    expect(r.level).toBe('stale')
    expect(r.message).toBe(
      'This information was last checked 1 day ago and may be out of date. Verify before relying on it.',
    )
  })

  it('keeps the plural for every other count', () => {
    expect(assessFreshness(daysAgo(2), { warnAfterDays: 0, staleAfterDays: 5 }, undefined, NOW).message).toBe(
      'This information was last checked 2 days ago.',
    )
    expect(assessFreshness(daysAgo(11), { warnAfterDays: 0, staleAfterDays: 5 }, undefined, NOW).message).toContain(
      'checked 11 days ago and',
    )
  })

  it('hands a custom message function the raw number, untouched', () => {
    const r = assessFreshness(daysAgo(1), { warnAfterDays: 0, staleAfterDays: 5 }, { aging: (n) => `n=${n}` }, NOW)
    expect(r.message).toBe('n=1')
  })
})

describe('dataset rows: computed fields win over caller fields', () => {
  const reviewedOn = '2020-01-01'

  it('keeps the computed level in result when a caller row has its own level field', () => {
    const d = checkDatasetFreshness([{ id: 'a', reviewedOn, level: 'fresh' } as never], CONFIG, undefined, NOW)
    expect(d.records[0]!.result.level).toBe('stale')
    expect(d.level).toBe('stale')
    expect(d.oldest?.result.level).toBe('stale')
  })

  it('replaces a caller field named result with the computed result', () => {
    const d = checkDatasetFreshness([{ id: 'a', reviewedOn, result: 'mine' } as never], CONFIG, undefined, NOW)
    expect(d.records[0]!.result).toEqual({
      level: 'stale',
      ageDays: ageInDays(reviewedOn, NOW),
      reviewedOn,
      message: expect.stringContaining('may be out of date') as string,
    })
  })

  it('keeps unrelated caller extras and passes a caller level through as an extra', () => {
    const d = checkDatasetFreshness(
      [{ id: 'a', reviewedOn, owner: 'ops', level: 'fresh' } as never],
      CONFIG,
      undefined,
      NOW,
    )
    const row = d.records[0] as unknown as Record<string, unknown>
    expect(row.owner).toBe('ops')
    expect(row.level).toBe('fresh') // the caller's own field, not the verdict
  })
})

describe('probes on the fixes', () => {
  it('a row parsed from JSON with an own __proto__ key cannot inject a result or pollute prototypes', () => {
    const row = JSON.parse('{"id":"a","reviewedOn":"2020-01-01","__proto__":{"result":"x"},"level":"fresh"}') as never
    const d = checkDatasetFreshness([row], CONFIG, undefined, NOW)
    expect(d.records[0]!.result.level).toBe('stale')
    expect(({} as Record<string, unknown>).result).toBeUndefined()
  })

  it('a Date subclass is still accepted as the clock', () => {
    class Clock extends Date {}
    expect(ageInDays('2026-10-01', new Clock(NOW))).toBe(9)
  })

  it('a cross-realm Date with a huge but valid time is accepted, an out-of-range one is not', () => {
    const edge = vm.runInNewContext('new Date(8.64e15)') as Date
    expect(ageInDays('2026-10-01', edge)).toBeGreaterThan(0)
    const bad = vm.runInNewContext('new Date(8.64e15 + 1)') as Date
    expect(() => ageInDays('2026-10-01', bad)).toThrow(RangeError)
  })

  it('a cross-realm Date whose getTime was overridden to a string is rejected', () => {
    const lying = vm.runInNewContext("const d = new Date(0); d.getTime = () => '5'; d") as Date
    expect(() => ageInDays('1970-01-01', lying)).toThrow(RangeError)
  })

  it('a revoked Proxy as the clock is a RangeError, not a TypeError', () => {
    const revoked = Proxy.revocable(new Date(NOW), {})
    revoked.revoke()
    expect(() => ageInDays('2026-10-01', revoked.proxy)).toThrow(RangeError)
  })

  it('a tie-break across an empty-then-single dataset still returns the only record', () => {
    expect(checkDatasetFreshness([], CONFIG, undefined, NOW).oldest).toBeUndefined()
    const one = checkDatasetFreshness([{ id: 'only', reviewedOn: '2026-10-09' }], CONFIG, undefined, NOW)
    expect(one.oldest?.id).toBe('only')
  })

  it('1 day is singular for a dataset row message too', () => {
    const d = checkDatasetFreshness([{ id: 'a', reviewedOn: '2026-10-09' }], { warnAfterDays: 0, staleAfterDays: 9 }, undefined, NOW)
    expect(d.records[0]!.result.message).toBe('This information was last checked 1 day ago.')
  })
})

describe('a Date from another realm is accepted as the clock', () => {
  const foreign = vm.runInNewContext("new Date('2026-10-10T12:00:00Z')") as Date

  it('is not an instance of this realm\'s Date (the premise)', () => {
    expect(foreign instanceof Date).toBe(false)
  })

  it('accepts a valid cross-realm Date in every entry point', () => {
    expect(ageInDays('2026-08-01', foreign)).toBe(70)
    expect(assessFreshness('2026-08-01', CONFIG, undefined, foreign).level).toBe('stale')
    expect(checkDatasetFreshness([{ id: 'a', reviewedOn: '2026-10-09' }], CONFIG, undefined, foreign).level).toBe('fresh')
  })

  it('still rejects an invalid cross-realm Date', () => {
    const bad = vm.runInNewContext('new Date(NaN)') as Date
    expect(() => ageInDays('2026-08-01', bad)).toThrow(RangeError)
  })

  it('still rejects a Date-shaped fake that only spoofs the tag', () => {
    const fake = { [Symbol.toStringTag]: 'Date', getTime: () => NOW.getTime() } as unknown as Date
    expect(() => ageInDays('2026-08-01', fake)).toThrow(RangeError)
  })

  it('still rejects a number, a string and null as the clock', () => {
    for (const value of [NOW.getTime(), '2026-10-10', null]) {
      expect(() => ageInDays('2026-08-01', value as never)).toThrow(RangeError)
    }
  })

  it('still rejects a Proxy around a Date', () => {
    expect(() => ageInDays('2026-08-01', new Proxy(new Date(NOW), {}))).toThrow(RangeError)
  })
})

describe('threshold semantics: "stale after N days" means more than N whole days', () => {
  const at = (reviewedOn: string, now: string) => assessFreshness(reviewedOn, CONFIG, undefined, new Date(now))

  it('is still aging at 45 days and 23 hours 59 minutes, stale at exactly 46 days', () => {
    expect(at('2026-08-25T12:00:00Z', '2026-10-09T11:59:59Z').level).toBe('aging') // 44d 23h 59m
    expect(at('2026-08-25T12:00:00Z', '2026-10-09T12:00:00Z').level).toBe('aging') // exactly 45d
    expect(at('2026-08-25T12:00:00Z', '2026-10-09T23:59:59Z').level).toBe('aging') // 45d 11h 59m
    expect(at('2026-08-25T12:00:00Z', '2026-10-10T11:59:59Z').level).toBe('aging') // 45d 23h 59m
    expect(at('2026-08-25T12:00:00Z', '2026-10-10T12:00:00Z').level).toBe('stale') // exactly 46d
  })

  it('is still fresh at 14 days and 23 hours 59 minutes, aging at exactly 15 days', () => {
    expect(at('2026-09-25T12:00:00Z', '2026-10-10T11:59:59Z').level).toBe('fresh')
    expect(at('2026-09-25T12:00:00Z', '2026-10-10T12:00:00Z').level).toBe('aging')
  })
})

describe('oldest breaks whole-day ties by the exact review instant', () => {
  it('prefers the exactly older record when both floor to the same age', () => {
    const d = checkDatasetFreshness(
      [
        { id: 'newer', reviewedOn: '2026-10-05T12:00:00Z' },
        { id: 'older', reviewedOn: '2026-10-04T12:00:01Z' },
      ],
      CONFIG,
      undefined,
      NOW,
    )
    expect(d.records.map((r) => r.result.ageDays)).toEqual([5, 5])
    expect(d.oldest?.id).toBe('older')
    expect(d.level).toBe('fresh')
  })

  it('keeps the first record when the instants are identical', () => {
    const d = checkDatasetFreshness(
      [
        { id: 'first', reviewedOn: '2026-10-01' },
        { id: 'second', reviewedOn: '2026-10-01T00:00:00Z' },
      ],
      CONFIG,
      undefined,
      NOW,
    )
    expect(d.oldest?.id).toBe('first')
  })

  it('compares instants across offsets, not the printed clock time', () => {
    const d = checkDatasetFreshness(
      [
        { id: 'plus', reviewedOn: '2026-10-05T14:00:00+02:00' }, // 12:00Z
        { id: 'minus', reviewedOn: '2026-10-05T07:00:00-05:00' }, // 12:00Z, identical instant
        { id: 'earlier', reviewedOn: '2026-10-05T11:59:59Z' },
      ],
      CONFIG,
      undefined,
      NOW,
    )
    expect(d.oldest?.id).toBe('earlier')
  })

  it('does not let a larger floored age lose to a smaller one with an earlier-looking instant', () => {
    const d = checkDatasetFreshness(
      [
        { id: 'six', reviewedOn: '2026-10-04T12:00:00Z' },
        { id: 'five', reviewedOn: '2026-10-05T12:00:01Z' },
      ],
      CONFIG,
      undefined,
      NOW,
    )
    expect(d.oldest?.id).toBe('six')
  })

  it('treats bare future-tolerated dates (age 0) by instant too', () => {
    const now = new Date('2026-10-10T20:00:00Z')
    const d = checkDatasetFreshness(
      [
        { id: 'tomorrow', reviewedOn: '2026-10-11' }, // later than now, accepted, age 0
        { id: 'today', reviewedOn: '2026-10-10' },
      ],
      CONFIG,
      undefined,
      now,
    )
    expect(d.oldest?.id).toBe('today')
  })
})

describe('guard: existing boundaries and rejections do not move', () => {
  it.each([
    [14, 'fresh'],
    [15, 'aging'],
    [45, 'aging'],
    [46, 'stale'],
  ] as const)('%i days old is %s', (n, level) => {
    expect(assessFreshness(daysAgo(n), CONFIG, undefined, NOW).level).toBe(level)
  })

  it('rejects a future timestamp by even one millisecond', () => {
    expect(() => assessFreshness('2026-10-10T12:00:00.001Z', CONFIG, undefined, NOW)).toThrow(RangeError)
  })

  it('rejects a bare date more than 14 hours ahead and accepts one inside it', () => {
    expect(() => assessFreshness('2026-10-11', CONFIG, undefined, new Date('2026-10-09T09:59:59.999Z'))).toThrow(RangeError)
    expect(assessFreshness('2026-10-11', CONFIG, undefined, new Date('2026-10-10T10:00:00Z')).ageDays).toBe(0)
  })

  it('rejects bad config', () => {
    for (const config of [null, { warnAfterDays: 45, staleAfterDays: 14 }, { warnAfterDays: -1, staleAfterDays: 3 }, { warnAfterDays: 1.5, staleAfterDays: 3 }]) {
      expect(() => assessFreshness(daysAgo(1), config as never, undefined, NOW)).toThrow(RangeError)
    }
  })

  it('gives the same verdict whatever the process time zone', () => {
    const original = process.env.TZ
    try {
      const seen = ['UTC', 'Pacific/Kiritimati', 'Pacific/Pago_Pago', 'America/Chicago'].map((tz) => {
        process.env.TZ = tz
        return JSON.stringify(assessFreshness('2026-08-25', CONFIG, undefined, NOW))
      })
      expect(new Set(seen).size).toBe(1)
    } finally {
      if (original === undefined) delete process.env.TZ
      else process.env.TZ = original
    }
  })

  it('README example values still hold', () => {
    const now = new Date('2026-08-02T12:00:00Z')
    const r = assessFreshness('2026-06-01', CONFIG, undefined, now)
    expect(r).toEqual({
      level: 'stale',
      ageDays: 62,
      reviewedOn: '2026-06-01',
      message: 'This information was last checked 62 days ago and may be out of date. Verify before relying on it.',
    })
    expect(freshnessBadgeText(r)).toBe('Stale — last reviewed 62d ago')
    const d = checkDatasetFreshness(
      [
        { id: 'omaha', reviewedOn: '2026-07-20' },
        { id: 'lisbon', reviewedOn: '2026-05-02' },
        { id: 'austin', reviewedOn: '2026-07-30' },
      ],
      CONFIG,
      undefined,
      now,
    )
    expect(d.level).toBe('stale')
    expect(d.oldest?.id).toBe('lisbon')
    expect(d.records.map((x) => [x.id, x.result.level, x.result.ageDays])).toEqual([
      ['omaha', 'fresh', 13],
      ['lisbon', 'stale', 92],
      ['austin', 'fresh', 3],
    ])
  })
})
