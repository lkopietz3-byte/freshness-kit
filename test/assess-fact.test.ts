import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import vm from 'node:vm'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { assessFact, assessFacts } from '../src/index.js'
import type { DatedFact, FactPolicy } from '../src/index.js'

const NOW = new Date('2026-10-10T12:00:00Z')
const DEFAULTS: FactPolicy = { warnAfterDays: 14, staleAfterDays: 45 }

function daysAgo(n: number): string {
  return new Date(NOW.getTime() - n * 86_400_000).toISOString().slice(0, 10)
}

function fact(over: Partial<DatedFact> & { id: string }): DatedFact {
  return { checkedAt: daysAgo(1), source: 'https://example.com/source', ...over }
}

interface Row {
  name: string
  fact: DatedFact
  defaults?: FactPolicy
  level: string
  display: string
  label: string
  ageDays: number | null
}

// The verdict table: one named fact per row, expected level, display and label.
const TABLE: Row[] = [
  { name: 'checked today', fact: fact({ id: 'f0', checkedAt: '2026-10-10' }), defaults: DEFAULTS, level: 'fresh', display: 'show', label: 'Checked today', ageDays: 0 },
  { name: 'fresh, singular 1 day', fact: fact({ id: 'f1', checkedAt: daysAgo(1) }), defaults: DEFAULTS, level: 'fresh', display: 'show', label: 'Checked 1 day ago', ageDays: 1 },
  { name: 'fresh, plural 3 days', fact: fact({ id: 'f3', checkedAt: daysAgo(3) }), defaults: DEFAULTS, level: 'fresh', display: 'show', label: 'Checked 3 days ago', ageDays: 3 },
  { name: 'fresh AT warnAfterDays (14)', fact: fact({ id: 'w14', checkedAt: daysAgo(14) }), defaults: DEFAULTS, level: 'fresh', display: 'show', label: 'Checked 14 days ago', ageDays: 14 },
  { name: 'aging at warnAfterDays + 1 (15)', fact: fact({ id: 'w15', checkedAt: daysAgo(15) }), defaults: DEFAULTS, level: 'aging', display: 'caveat', label: 'Checked 15 days ago', ageDays: 15 },
  { name: 'aging AT staleAfterDays (45)', fact: fact({ id: 's45', checkedAt: daysAgo(45) }), defaults: DEFAULTS, level: 'aging', display: 'caveat', label: 'Checked 45 days ago', ageDays: 45 },
  { name: 'stale at staleAfterDays + 1 (46)', fact: fact({ id: 's46', checkedAt: daysAgo(46) }), defaults: DEFAULTS, level: 'stale', display: 'caveat', label: 'Checked 46 days ago', ageDays: 46 },
  { name: 'stale with a 1-day threshold, singular', fact: fact({ id: 'st1', checkedAt: daysAgo(1), policy: { warnAfterDays: 0, staleAfterDays: 0 } }), level: 'stale', display: 'caveat', label: 'Checked 1 day ago', ageDays: 1 },
  { name: 'per-fact policy beats defaults (stale at 6 days)', fact: fact({ id: 'pol', checkedAt: daysAgo(6), policy: { warnAfterDays: 2, staleAfterDays: 5 } }), defaults: DEFAULTS, level: 'stale', display: 'caveat', label: 'Checked 6 days ago', ageDays: 6 },
  { name: 'per-fact policy alone, no defaults', fact: fact({ id: 'solo', checkedAt: daysAgo(3), policy: { warnAfterDays: 2, staleAfterDays: 5 } }), level: 'aging', display: 'caveat', label: 'Checked 3 days ago', ageDays: 3 },
  { name: 'stale withhold override on the fact', fact: fact({ id: 'sw', checkedAt: daysAgo(50), policy: { warnAfterDays: 14, staleAfterDays: 45, staleDisplay: 'withhold' } }), level: 'stale', display: 'withhold', label: 'Checked 50 days ago', ageDays: 50 },
  { name: 'stale withhold override from defaults', fact: fact({ id: 'swd', checkedAt: daysAgo(50) }), defaults: { ...DEFAULTS, staleDisplay: 'withhold' }, level: 'stale', display: 'withhold', label: 'Checked 50 days ago', ageDays: 50 },
  { name: 'fact staleDisplay caveat beats defaults withhold', fact: fact({ id: 'swc', checkedAt: daysAgo(50), policy: { warnAfterDays: 14, staleAfterDays: 45, staleDisplay: 'caveat' } }), defaults: { ...DEFAULTS, staleDisplay: 'withhold' }, level: 'stale', display: 'caveat', label: 'Checked 50 days ago', ageDays: 50 },
  { name: 'staleDisplay withhold does not touch aging', fact: fact({ id: 'swa', checkedAt: daysAgo(20), policy: { warnAfterDays: 14, staleAfterDays: 45, staleDisplay: 'withhold' } }), level: 'aging', display: 'caveat', label: 'Checked 20 days ago', ageDays: 20 },
  { name: 'expired, inclusive default, exactly at the instant', fact: fact({ id: 'ex-at', expiresAt: '2026-10-10T12:00:00Z' }), defaults: DEFAULTS, level: 'expired', display: 'withhold', label: 'Expired', ageDays: 1 },
  { name: 'not expired one millisecond before, inclusive', fact: fact({ id: 'ex-before', expiresAt: '2026-10-10T12:00:00.001Z' }), defaults: DEFAULTS, level: 'fresh', display: 'show', label: 'Checked 1 day ago', ageDays: 1 },
  { name: 'expired after the instant, inclusive', fact: fact({ id: 'ex-after', expiresAt: '2026-10-10T11:59:59Z' }), defaults: DEFAULTS, level: 'expired', display: 'withhold', label: 'Expired', ageDays: 1 },
  { name: 'exclusive boundary shows exactly at the instant', fact: fact({ id: 'xc-at', expiresAt: '2026-10-10T12:00:00Z', boundary: 'exclusive' }), defaults: DEFAULTS, level: 'fresh', display: 'show', label: 'Checked 1 day ago', ageDays: 1 },
  { name: 'exclusive boundary expires after the instant', fact: fact({ id: 'xc-after', expiresAt: '2026-10-10T11:59:59.999Z', boundary: 'exclusive' }), defaults: DEFAULTS, level: 'expired', display: 'withhold', label: 'Expired', ageDays: 1 },
  { name: 'explicit inclusive boundary matches the default', fact: fact({ id: 'inc', expiresAt: '2026-10-10T12:00:00Z', boundary: 'inclusive' }), defaults: DEFAULTS, level: 'expired', display: 'withhold', label: 'Expired', ageDays: 1 },
  { name: 'bare-date expiresAt is UTC midnight of that date', fact: fact({ id: 'bare-ex', expiresAt: '2026-10-10' }), defaults: DEFAULTS, level: 'expired', display: 'withhold', label: 'Expired', ageDays: 1 },
  { name: 'bare-date expiresAt tomorrow is still live', fact: fact({ id: 'bare-live', expiresAt: '2026-10-11' }), defaults: DEFAULTS, level: 'fresh', display: 'show', label: 'Checked 1 day ago', ageDays: 1 },
  { name: 'expiry beats stale', fact: fact({ id: 'ex-stale', checkedAt: daysAgo(90), expiresAt: '2026-10-01' }), defaults: DEFAULTS, level: 'expired', display: 'withhold', label: 'Expired', ageDays: 90 },
  { name: 'expiry needs no thresholds', fact: fact({ id: 'ex-nopol', expiresAt: '2026-10-01' }), level: 'expired', display: 'withhold', label: 'Expired', ageDays: 1 },
  { name: 'future bare date inside the 14 hour grace reads as age 0', fact: fact({ id: 'grace', checkedAt: '2026-10-11' }), defaults: DEFAULTS, level: 'fresh', display: 'show', label: 'Checked today', ageDays: 0 },
  { name: 'future bare date beyond the grace is invalid', fact: fact({ id: 'future-bare', checkedAt: '2026-10-12' }), defaults: DEFAULTS, level: 'invalid', display: 'withhold', label: 'Date unknown', ageDays: null },
  { name: 'future timestamp by one millisecond is invalid', fact: fact({ id: 'future-ts', checkedAt: '2026-10-10T12:00:00.001Z' }), defaults: DEFAULTS, level: 'invalid', display: 'withhold', label: 'Date unknown', ageDays: null },
  { name: 'timestamp exactly now is fresh today', fact: fact({ id: 'now-ts', checkedAt: '2026-10-10T12:00:00Z' }), defaults: DEFAULTS, level: 'fresh', display: 'show', label: 'Checked today', ageDays: 0 },
  { name: 'future checkedAt is invalid even when expired', fact: fact({ id: 'future-ex', checkedAt: '2027-01-01', expiresAt: '2026-01-01' }), defaults: DEFAULTS, level: 'invalid', display: 'withhold', label: 'Date unknown', ageDays: null },
  { name: 'garbage checkedAt', fact: fact({ id: 'garbage', checkedAt: 'last tuesday' }), defaults: DEFAULTS, level: 'invalid', display: 'withhold', label: 'Date unknown', ageDays: null },
  { name: 'impossible calendar date', fact: fact({ id: 'feb30', checkedAt: '2026-02-30' }), defaults: DEFAULTS, level: 'invalid', display: 'withhold', label: 'Date unknown', ageDays: null },
  { name: 'timestamp without a timezone', fact: fact({ id: 'no-tz', checkedAt: '2026-10-09T10:00:00' }), defaults: DEFAULTS, level: 'invalid', display: 'withhold', label: 'Date unknown', ageDays: null },
  { name: 'empty checkedAt', fact: fact({ id: 'empty-date', checkedAt: '' }), defaults: DEFAULTS, level: 'invalid', display: 'withhold', label: 'Date unknown', ageDays: null },
  { name: 'checkedAt of the wrong runtime type', fact: { id: 'num-date', checkedAt: 20261009 as unknown as string, source: 'x' }, defaults: DEFAULTS, level: 'invalid', display: 'withhold', label: 'Date unknown', ageDays: null },
  { name: 'missing checkedAt', fact: { id: 'no-date', source: 'x' } as unknown as DatedFact, defaults: DEFAULTS, level: 'invalid', display: 'withhold', label: 'Date unknown', ageDays: null },
  { name: 'garbage expiresAt', fact: fact({ id: 'bad-ex', expiresAt: 'soon' }), defaults: DEFAULTS, level: 'invalid', display: 'withhold', label: 'Date unknown', ageDays: null },
  { name: 'blank expiresAt', fact: fact({ id: 'blank-ex', expiresAt: '' }), defaults: DEFAULTS, level: 'invalid', display: 'withhold', label: 'Date unknown', ageDays: null },
  { name: 'null expiresAt is not silently "no expiry"', fact: fact({ id: 'null-ex', expiresAt: null as unknown as string }), defaults: DEFAULTS, level: 'invalid', display: 'withhold', label: 'Date unknown', ageDays: null },
  { name: 'missing source', fact: { id: 'no-src', checkedAt: daysAgo(1) } as unknown as DatedFact, defaults: DEFAULTS, level: 'invalid', display: 'withhold', label: 'Source unknown', ageDays: null },
  { name: 'blank source', fact: fact({ id: 'blank-src', source: '   ' }), defaults: DEFAULTS, level: 'invalid', display: 'withhold', label: 'Source unknown', ageDays: null },
  { name: 'empty source', fact: fact({ id: 'empty-src', source: '' }), defaults: DEFAULTS, level: 'invalid', display: 'withhold', label: 'Source unknown', ageDays: null },
  { name: 'source of the wrong runtime type', fact: fact({ id: 'num-src', source: 5 as unknown as string }), defaults: DEFAULTS, level: 'invalid', display: 'withhold', label: 'Source unknown', ageDays: null },
  { name: 'no policy and no defaults', fact: fact({ id: 'no-pol' }), level: 'invalid', display: 'withhold', label: 'Unverified', ageDays: null },
  { name: 'non-string id is echoed as empty', fact: fact({ id: 5 as unknown as string }), defaults: DEFAULTS, level: 'fresh', display: 'show', label: 'Checked 1 day ago', ageDays: 1 },
]

describe('assessFact verdict table', () => {
  for (const row of TABLE) {
    it(`${row.name}`, () => {
      const a = assessFact(row.fact, NOW, row.defaults)
      expect({ level: a.level, display: a.display, label: a.label, ageDays: a.ageDays }).toEqual({
        level: row.level,
        display: row.display,
        label: row.label,
        ageDays: row.ageDays,
      })
      expect(a.id).toBe(typeof row.fact.id === 'string' ? row.fact.id : '')
      expect(a.reason.length).toBeGreaterThan(10)
      expect(a.reason).not.toMatch(/\s{2,}|—|–/)
    })
  }

  it('covers every level, both boundaries and every display', () => {
    const results = TABLE.map((r) => assessFact(r.fact, NOW, r.defaults))
    expect(new Set(results.map((r) => r.level))).toEqual(new Set(['fresh', 'aging', 'stale', 'expired', 'invalid']))
    expect(new Set(results.map((r) => r.display))).toEqual(new Set(['show', 'caveat', 'withhold']))
  })

  it('explains each level in plain words', () => {
    expect(assessFact(fact({ id: 'a', checkedAt: daysAgo(3) }), NOW, DEFAULTS).reason).toBe('Checked 3 days ago, within 14 days.')
    expect(assessFact(fact({ id: 'a', checkedAt: daysAgo(20) }), NOW, DEFAULTS).reason).toBe('Checked 20 days ago, past 14 days.')
    expect(assessFact(fact({ id: 'a', checkedAt: daysAgo(50) }), NOW, DEFAULTS).reason).toBe('Checked 50 days ago, past 45 days.')
    expect(assessFact(fact({ id: 'a', expiresAt: '2026-10-01' }), NOW, DEFAULTS).reason).toBe('Expired: now is at or after expiresAt 2026-10-01.')
    expect(assessFact(fact({ id: 'a', expiresAt: '2026-10-01', boundary: 'exclusive' }), NOW, DEFAULTS).reason).toBe('Expired: now is after expiresAt 2026-10-01.')
    expect(assessFact(fact({ id: 'a', checkedAt: daysAgo(1), policy: { warnAfterDays: 1, staleAfterDays: 1 } }), NOW).reason).toBe('Checked 1 day ago, within 1 day.')
  })

  it('does not echo raw garbage into the reason', () => {
    const a = assessFact(fact({ id: 'a', checkedAt: '<script>alert(1)</script>' }), NOW, DEFAULTS)
    expect(a.reason).not.toContain('script')
  })

  it('is deterministic: the same input gives the same answer', () => {
    const f = fact({ id: 'd', checkedAt: daysAgo(20), expiresAt: '2026-12-01' })
    expect(assessFact(f, NOW, DEFAULTS)).toEqual(assessFact(f, new Date(NOW.getTime()), DEFAULTS))
  })

  it('does not mutate the fact or the policies', () => {
    const f = fact({ id: 'm', policy: { warnAfterDays: 1, staleAfterDays: 2 } })
    const d: FactPolicy = { ...DEFAULTS }
    const before = JSON.stringify([f, d])
    assessFact(f, NOW, d)
    expect(JSON.stringify([f, d])).toBe(before)
  })
})

describe('README example values still hold', () => {
  const hours: DatedFact = { id: 'hours', checkedAt: '2026-10-07', source: 'https://example.com/hours' }
  const promo: DatedFact = { id: 'promo', checkedAt: '2026-10-01', source: 'https://example.com/promo', expiresAt: '2026-10-10T12:00:00Z' }
  const price: DatedFact = {
    id: 'price',
    checkedAt: '2026-08-01',
    source: 'https://example.com/price',
    policy: { warnAfterDays: 7, staleAfterDays: 30, staleDisplay: 'withhold' },
  }
  it('matches the documented results', () => {
    expect(assessFact(hours, NOW, DEFAULTS)).toEqual({
      id: 'hours', level: 'fresh', display: 'show', ageDays: 3,
      reason: 'Checked 3 days ago, within 14 days.', label: 'Checked 3 days ago',
    })
    expect(assessFact(promo, NOW, DEFAULTS)).toEqual({
      id: 'promo', level: 'expired', display: 'withhold', ageDays: 9,
      reason: 'Expired: now is at or after expiresAt 2026-10-10T12:00:00Z.', label: 'Expired',
    })
    expect(assessFact(price, NOW, DEFAULTS).display).toBe('withhold')
    const r = assessFacts([hours, promo, price], NOW, DEFAULTS)
    expect(r.counts).toEqual({ fresh: 1, aging: 0, stale: 1, expired: 1, invalid: 0 })
    expect(r.worst?.id).toBe('promo')
    expect(assessFact(hours, NOW, DEFAULTS, { fresh: (a) => `Verified ${String(a)}d ago` }).label).toBe('Verified 3d ago')
  })
})

describe('assessFact with a custom label formatter', () => {
  it('replaces only the levels named, with the kit message-function shape', () => {
    const labels = { aging: (age: number | null, checkedAt: string) => `${String(age)}d since ${checkedAt}` }
    const aging = assessFact(fact({ id: 'a', checkedAt: daysAgo(20) }), NOW, DEFAULTS, labels)
    expect(aging.label).toBe(`20d since ${daysAgo(20)}`)
    expect(assessFact(fact({ id: 'a', checkedAt: daysAgo(3) }), NOW, DEFAULTS, labels).label).toBe('Checked 3 days ago')
  })

  it('can relabel expired and invalid', () => {
    const labels = { expired: () => 'Ended', invalid: (age: number | null) => `unknown ${String(age)}` }
    expect(assessFact(fact({ id: 'a', expiresAt: '2026-10-01' }), NOW, DEFAULTS, labels).label).toBe('Ended')
    expect(assessFact(fact({ id: 'a', checkedAt: 'nope' }), NOW, DEFAULTS, labels).label).toBe('unknown null')
  })

  it('rejects a labels value that is not a plain object of functions', () => {
    expect(() => assessFact(fact({ id: 'a' }), NOW, DEFAULTS, null as never)).toThrow(TypeError)
    expect(() => assessFact(fact({ id: 'a' }), NOW, DEFAULTS, new Map() as never)).toThrow(TypeError)
    expect(() => assessFact(fact({ id: 'a' }), NOW, DEFAULTS, { fresh: 'x' } as never)).toThrow(TypeError)
    expect(() => assessFact(fact({ id: 'a' }), NOW, DEFAULTS, { fresh: () => 5 } as never)).toThrow(TypeError)
  })
})

describe('assessFact programmer errors still throw clear TypeErrors', () => {
  const f = fact({ id: 'p' })
  it('now must be a valid Date', () => {
    for (const bad of [undefined, null, 0, '2026-10-10', { getTime: () => 0 }, new Date('nope')]) {
      expect(() => assessFact(f, bad as never, DEFAULTS)).toThrow(TypeError)
      expect(() => assessFacts([f], bad as never, DEFAULTS)).toThrow(TypeError)
    }
  })
  it('facts must be an array without holes', () => {
    for (const bad of [undefined, null, 'x', {}, f]) {
      expect(() => assessFacts(bad as never, NOW, DEFAULTS)).toThrow(TypeError)
    }
    expect(() => assessFacts(new Array(1) as never, NOW, DEFAULTS)).toThrow(TypeError)
  })
  it('a fact must be an object', () => {
    for (const bad of [undefined, null, 'x', 5, []]) {
      expect(() => assessFact(bad as never, NOW, DEFAULTS)).toThrow(TypeError)
      expect(() => assessFacts([bad as never], NOW, DEFAULTS)).toThrow(TypeError)
    }
  })
  it('a policy or defaults of the wrong type', () => {
    for (const bad of [null, 'x', 5, [], { warnAfterDays: '1', staleAfterDays: 2 }, { staleAfterDays: 2 }, { warnAfterDays: 1, staleAfterDays: 2, staleDisplay: 'hide' }]) {
      expect(() => assessFact(fact({ id: 'p', policy: bad as never }), NOW, DEFAULTS)).toThrow(TypeError)
      expect(() => assessFact(f, NOW, bad as never)).toThrow(TypeError)
    }
  })
  it('a policy is checked even when the fact data is bad', () => {
    expect(() => assessFact(fact({ id: 'p', source: '', policy: 5 as never }), NOW, DEFAULTS)).toThrow(TypeError)
  })
  it('thresholds that are numbers but out of range throw the kit RangeError', () => {
    for (const bad of [{ warnAfterDays: 45, staleAfterDays: 14 }, { warnAfterDays: -1, staleAfterDays: 3 }, { warnAfterDays: 1.5, staleAfterDays: 3 }, { warnAfterDays: NaN, staleAfterDays: 3 }]) {
      expect(() => assessFact(fact({ id: 'p', policy: bad }), NOW, DEFAULTS)).toThrow(RangeError)
      expect(() => assessFact(f, NOW, bad)).toThrow(RangeError)
    }
  })
  it('an unknown boundary', () => {
    expect(() => assessFact(fact({ id: 'p', boundary: 'both' as never }), NOW, DEFAULTS)).toThrow(TypeError)
  })
})

describe('assessFact input handling', () => {
  it('accepts a Date from another realm as the clock', () => {
    const foreign = vm.runInNewContext('new Date("2026-10-10T12:00:00Z")') as Date
    expect(foreign instanceof Date).toBe(false)
    const a = assessFact(fact({ id: 'x', checkedAt: daysAgo(20) }), foreign, DEFAULTS)
    expect(a.level).toBe('aging')
    expect(assessFacts([fact({ id: 'x' })], foreign, DEFAULTS).counts.fresh).toBe(1)
  })

  it('reads the clock once', () => {
    let reads = 0
    class CountingDate extends Date {
      override getTime(): number {
        reads += 1
        return super.getTime()
      }
    }
    const facts = [fact({ id: 'a' }), fact({ id: 'b' }), fact({ id: 'c' })]
    assessFacts(facts, new CountingDate(NOW.getTime()), DEFAULTS)
    // readNow calls the intrinsic getTime and the override once each; what matters is that it does not grow with the number of facts.
    const perCall = reads
    reads = 0
    assessFacts([...facts, ...facts, ...facts], new CountingDate(NOW.getTime()), DEFAULTS)
    expect(reads).toBe(perCall)
  })

  it('fails closed on a fact whose getter throws, instead of crashing the request', () => {
    const hostile = {
      id: 'hostile',
      get checkedAt(): string {
        throw new Error('boom')
      },
      source: 'x',
    } as unknown as DatedFact
    const a = assessFact(hostile, NOW, DEFAULTS)
    expect(a.level).toBe('invalid')
    expect(a.display).toBe('withhold')
    const revoked = Proxy.revocable({}, {})
    revoked.revoke()
    expect(assessFact(revoked.proxy as unknown as DatedFact, NOW, DEFAULTS).level).toBe('invalid')
  })

  it('reads each fact field once', () => {
    const reads: Record<string, number> = {}
    const counted = (name: string, value: unknown) => ({
      get: () => {
        reads[name] = (reads[name] ?? 0) + 1
        return value
      },
      enumerable: true,
    })
    const f = Object.defineProperties({}, {
      id: counted('id', 'g'),
      checkedAt: counted('checkedAt', daysAgo(2)),
      source: counted('source', 'x'),
      expiresAt: counted('expiresAt', '2026-12-01'),
      policy: counted('policy', undefined),
      boundary: counted('boundary', undefined),
    }) as DatedFact
    assessFact(f, NOW, DEFAULTS)
    expect(Object.values(reads)).toEqual([1, 1, 1, 1, 1, 1])
  })
})

describe('assessFacts', () => {
  const list: DatedFact[] = [
    fact({ id: 'fresh-1', checkedAt: daysAgo(2) }),
    fact({ id: 'aging-1', checkedAt: daysAgo(20) }),
    fact({ id: 'stale-1', checkedAt: daysAgo(60) }),
    fact({ id: 'stale-2', checkedAt: daysAgo(70) }),
    fact({ id: 'expired-1', expiresAt: '2026-10-01' }),
    fact({ id: 'invalid-1', source: '' }),
    fact({ id: 'fresh-2', checkedAt: daysAgo(0) }),
  ]

  it('returns results in input order with counts and the worst result', () => {
    const r = assessFacts(list, NOW, DEFAULTS)
    expect(r.results.map((x) => [x.id, x.level])).toEqual([
      ['fresh-1', 'fresh'], ['aging-1', 'aging'], ['stale-1', 'stale'], ['stale-2', 'stale'],
      ['expired-1', 'expired'], ['invalid-1', 'invalid'], ['fresh-2', 'fresh'],
    ])
    expect(r.counts).toEqual({ fresh: 2, aging: 1, stale: 2, expired: 1, invalid: 1 })
    expect(r.worst?.id).toBe('invalid-1')
  })

  it('each result equals what assessFact gives alone', () => {
    const r = assessFacts(list, NOW, DEFAULTS)
    expect(r.results).toEqual(list.map((x) => assessFact(x, NOW, DEFAULTS)))
  })

  it('ranks worst as invalid, expired, stale, aging, fresh and keeps the first on a tie', () => {
    expect(assessFacts(list.slice(0, 5), NOW, DEFAULTS).worst?.id).toBe('expired-1')
    expect(assessFacts(list.slice(0, 4), NOW, DEFAULTS).worst?.id).toBe('stale-1')
    expect(assessFacts(list.slice(0, 2), NOW, DEFAULTS).worst?.id).toBe('aging-1')
    expect(assessFacts([list[0]!, list[6]!], NOW, DEFAULTS).worst?.id).toBe('fresh-1')
  })

  it('returns null worst and zero counts for an empty list', () => {
    expect(assessFacts([], NOW, DEFAULTS)).toEqual({
      results: [],
      worst: null,
      counts: { fresh: 0, aging: 0, stale: 0, expired: 0, invalid: 0 },
    })
  })

  it('an empty list still validates the clock and defaults', () => {
    expect(() => assessFacts([], 'x' as never, DEFAULTS)).toThrow(TypeError)
    expect(() => assessFacts([], NOW, 5 as never)).toThrow(TypeError)
  })

  it('counts sum to the number of facts', () => {
    const r = assessFacts(list, NOW, DEFAULTS)
    expect(Object.values(r.counts).reduce((a, b) => a + b, 0)).toBe(list.length)
  })
})

describe('assessFact never throws on bad data (property test)', () => {
  // A small deterministic generator so a failure is reproducible.
  function lcg(seed: number): () => number {
    let s = seed >>> 0
    return () => {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0
      return s / 2 ** 32
    }
  }
  const rnd = lcg(20261010)
  const alphabets = [
    'abcdefghijklmnopqrstuvwxyz ',
    '0123456789-:TZ.+',
    '0123456789',
    '\u0000\u0007\n\r\t ​ 𐏿\ud83d',
    '<>&"\'`\\/{}[]()$%^*~|',
    '日本語中文한국어العربية',
  ]
  function randomString(): string {
    const alphabet = alphabets[Math.floor(rnd() * alphabets.length)]!
    const len = Math.floor(rnd() * 40)
    let out = ''
    for (let i = 0; i < len; i++) out += alphabet[Math.floor(rnd() * alphabet.length)]!
    return out
  }
  // Mutate real dates so the fuzz also lands near the grammar.
  function nearDate(): string {
    const base = ['2026-10-09', '2026-10-09T10:00:00Z', '2026-10-09T10:00:00.123+05:30', '2026-02-29', '2026-13-01', '2026-10-10T24:00:00Z'][Math.floor(rnd() * 6)]!
    const i = Math.floor(rnd() * (base.length + 1))
    return rnd() < 0.5 ? base.slice(0, i) + base.slice(i + 1) : base.slice(0, i) + randomString().slice(0, 2) + base.slice(i)
  }
  const pick = (): string => (rnd() < 0.4 ? nearDate() : randomString())

  it('never throws for 5000 random checkedAt, expiresAt and source strings', () => {
    for (let i = 0; i < 5000; i++) {
      const f: DatedFact = { id: randomString(), checkedAt: pick(), expiresAt: pick(), source: randomString() }
      const a = assessFact(f, NOW, DEFAULTS)
      expect(['fresh', 'aging', 'stale', 'expired', 'invalid']).toContain(a.level)
      if (a.level === 'invalid' || a.level === 'expired') expect(a.display).toBe('withhold')
      if (a.level === 'invalid') expect(a.ageDays).toBeNull()
      expect(typeof a.label).toBe('string')
      expect(typeof a.reason).toBe('string')
    }
  }, 60_000)

  it('never throws for random values of any type', () => {
    const values = (): unknown => {
      const k = Math.floor(rnd() * 9)
      return [undefined, null, 0, NaN, true, {}, [], () => 1, randomString()][k]
    }
    for (let i = 0; i < 2000; i++) {
      const f = { id: values(), checkedAt: values(), expiresAt: values(), source: values() } as unknown as DatedFact
      const a = assessFact(f, NOW, DEFAULTS)
      expect(a.display === 'show' ? a.level === 'fresh' : true).toBe(true)
    }
  }, 60_000)

  it('never shows a fact that is not fresh, and withholds every random garbage date', () => {
    for (let i = 0; i < 2000; i++) {
      const f: DatedFact = { id: 'g', checkedAt: randomString(), source: 'x' }
      const a = assessFact(f, NOW, DEFAULTS)
      // Random text is not a date; the only way it can be shown is if it happens to be a valid date.
      if (a.display !== 'withhold') expect(f.checkedAt).toMatch(/^\d{4}-\d{2}-\d{2}/)
    }
  }, 60_000)

  it('assessFacts counts always sum to the input length', () => {
    const facts: DatedFact[] = []
    for (let i = 0; i < 300; i++) facts.push({ id: `f${i}`, checkedAt: pick(), expiresAt: rnd() < 0.5 ? pick() : (undefined as unknown as string), source: rnd() < 0.8 ? 'src' : randomString() })
    const r = assessFacts(facts, NOW, DEFAULTS)
    expect(Object.values(r.counts).reduce((a, b) => a + b, 0)).toBe(300)
    expect(r.results.length).toBe(300)
  })
})

describe('assessFact gives the same verdicts in any process time zone', () => {
  const root = `${import.meta.dirname}/../`

  it('matches across UTC, Pacific/Kiritimati, Pacific/Pago_Pago and America/Chicago, each in its own process', () => {
    // Transpile the real sources to a temp dir so the child runs the code under test.
    const dir = mkdtempSync(`${tmpdir()}/freshness-kit-tz-`)
    try {
      mkdirSync(`${dir}/lib`, { recursive: true })
      writeFileSync(`${dir}/package.json`, '{"type":"module"}')
      for (const name of readdirSync(`${root}src`)) {
        if (!name.endsWith('.ts')) continue
        const out = ts.transpileModule(readFileSync(`${root}src/${name}`, 'utf8'), {
          compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
        })
        writeFileSync(`${dir}/lib/${name.replace(/\.ts$/, '.js')}`, out.outputText)
      }
      const cases = TABLE.filter((r) => r.name !== 'non-string id is echoed as empty')
        .map((r) => ({ fact: r.fact, defaults: r.defaults }))
      const driver = `
        import { assessFact } from '${dir}/lib/index.js'
        const now = new Date('2026-10-10T12:00:00Z')
        const cases = JSON.parse(process.env.CASES)
        console.log(JSON.stringify(cases.map((c) => assessFact(c.fact, now, c.defaults))))
      `
      const outputs = ['UTC', 'Pacific/Kiritimati', 'Pacific/Pago_Pago', 'America/Chicago'].map((tz) =>
        execFileSync('node', ['--input-type=module', '-e', driver], {
          env: { ...process.env, TZ: tz, CASES: JSON.stringify(cases) },
          encoding: 'utf8',
        }).trim(),
      )
      expect(new Set(outputs).size).toBe(1)
      const verdicts = JSON.parse(outputs[0]!) as { level: string; display: string; label: string }[]
      // The child saw the same answers as this process.
      expect(verdicts).toEqual(cases.map((c) => {
        const a = assessFact(c.fact, NOW, c.defaults)
        return JSON.parse(JSON.stringify(a)) as unknown
      }))
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }, 120_000)

  it('also holds in this process for a table of facts under four TZ values', () => {
    const original = process.env.TZ
    try {
      const seen = ['UTC', 'Pacific/Kiritimati', 'Pacific/Pago_Pago', 'America/Chicago'].map((tz) => {
        process.env.TZ = tz
        return JSON.stringify(TABLE.map((r) => assessFact(r.fact, NOW, r.defaults)))
      })
      expect(new Set(seen).size).toBe(1)
    } finally {
      if (original === undefined) delete process.env.TZ
      else process.env.TZ = original
    }
  })
})
