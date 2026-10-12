import { describe, expect, it } from 'vitest'
import { assessFact, assessFacts } from '../src/index.js'
import type { DatedFact, FactPolicy } from '../src/index.js'

// Field-trial rows. Real data arrives in shapes the strict date grammar rejects.
// The grammar stays strict and the fact is withheld; the reason must name the
// part that failed so an adopter can find the fix.
const NOW = new Date('2026-10-10T23:07:00Z')
const POLICY: FactPolicy = { warnAfterDays: 30, staleAfterDays: 90 }

function reasonFor(checkedAt: string, field: 'checkedAt' | 'expiresAt' = 'checkedAt'): string {
  const base: DatedFact = { id: 'r', checkedAt: '2026-09-01', source: 's' }
  const f = field === 'checkedAt' ? { ...base, checkedAt } : { ...base, expiresAt: checkedAt }
  const a = assessFact(f, NOW, POLICY)
  expect(a.level).toBe('invalid')
  expect(a.display).toBe('withhold')
  expect(a.ageDays).toBeNull()
  expect(a.label).toBe('Date unknown')
  return a.reason
}

describe('an unreadable date names the part that failed', () => {
  it('microsecond fraction with an offset (database timestamps)', () => {
    const r = reasonFor('2026-08-28T23:42:27.123456+00:00')
    expect(r).toContain('checkedAt')
    expect(r).toContain('6 fractional digits')
    expect(r).toContain('at most 3')
  })

  it('Postgres text with a space and a short offset', () => {
    const r = reasonFor('2026-08-28 23:42:27.123456+00')
    expect(r).toContain('space')
    expect(r).toContain('6 fractional digits')
    expect(r).toContain('offset')
  })

  it('git --date=iso output: space separator and an offset without a colon', () => {
    const r = reasonFor('2026-09-29 17:14:38 -0700')
    expect(r).toContain('space')
    expect(r).toContain('offset needs a colon')
  })

  it('an offset without a colon', () => {
    expect(reasonFor('2026-09-29T17:14:38+0000')).toContain('offset needs a colon')
  })

  it('a timestamp with no timezone', () => {
    expect(reasonFor('2026-09-29T17:14:38')).toContain('no timezone')
  })

  it('a timestamp with no seconds', () => {
    expect(reasonFor('2026-09-29T17:14')).toContain('no seconds')
    expect(reasonFor('2026-09-29T17:14Z')).toContain('no seconds')
  })

  it('a month-only date is a partial date', () => {
    const r = reasonFor('2026-07')
    expect(r).toContain('partial date')
    expect(r).toContain('YYYY-MM-DD')
  })

  it('a year-only date is a partial date', () => {
    expect(reasonFor('2026')).toContain('partial date')
  })

  it('a lowercase t or z', () => {
    expect(reasonFor('2026-09-29t17:14:38Z')).toContain('uppercase')
    expect(reasonFor('2026-09-29T17:14:38z')).toContain('uppercase')
  })

  it('surrounding whitespace', () => {
    expect(reasonFor(' 2026-09-29')).toContain('whitespace')
    expect(reasonFor('2026-09-29\n')).toContain('whitespace')
  })

  it('an impossible calendar date', () => {
    expect(reasonFor('2026-02-30')).toContain('real calendar date')
  })

  it('an hour of 24 is out of range', () => {
    expect(reasonFor('2026-09-29T24:00:00Z')).toContain('out of range')
  })

  it('prose is called prose', () => {
    expect(reasonFor('last tuesday')).toContain('not an ISO date')
    expect(reasonFor('')).toContain('empty')
  })

  it('names expiresAt when that is the field that failed', () => {
    const r = reasonFor('2026-10-31 23:59:59 -0500', 'expiresAt')
    expect(r).toContain('expiresAt')
    expect(r).toContain('space')
  })

  it('a non-string date says so', () => {
    const a = assessFact({ id: 'n', checkedAt: 20261009 as unknown as string, source: 's' }, NOW, POLICY)
    expect(a.reason).toContain('not a string')
  })

  it('every reason ends with the accepted grammar', () => {
    for (const bad of ['2026-07', '2026-09-29T17:14:38', 'soon', '2026-02-30']) {
      expect(reasonFor(bad)).toContain('Accepted: YYYY-MM-DD or YYYY-MM-DDTHH:mm:ss[.sss]')
    }
  })
})

describe('what a normalizer recipe produces is accepted', () => {
  it('new Date(x).toISOString() of a zoned microsecond timestamp is a fresh, aged fact', () => {
    const normalized = new Date('2026-08-28T23:42:27.123456+00:00').toISOString()
    expect(normalized).toBe('2026-08-28T23:42:27.123Z')
    const a = assessFact({ id: 'r', checkedAt: normalized, source: 's' }, NOW, POLICY)
    expect(a).toMatchObject({ level: 'aging', display: 'caveat', ageDays: 42 })
  })
})

describe('pinned behavior the README documents as limits', () => {
  it('a three-minute clock skew on a timestamp is withheld (no grace for timestamps)', () => {
    const a = assessFact({ id: 'p', checkedAt: '2026-08-30T17:30:00.000Z', source: 's' }, new Date('2026-08-30T17:27:00Z'), POLICY)
    expect(a).toMatchObject({ level: 'invalid', display: 'withhold' })
  })

  it('a bare-date expiresAt is UTC midnight at the start of that date', () => {
    const f: DatedFact = { id: 'o', checkedAt: '2026-10-20', expiresAt: '2026-10-31', source: 's' }
    const eveningBefore = new Date('2026-10-30T20:00:00-05:00')
    expect(assessFact(f, eveningBefore, POLICY).level).toBe('expired')
    // Recipe for "valid through Oct 31 in Central time": expire at the start of the next local day.
    const asValidThrough: DatedFact = { ...f, expiresAt: '2026-11-01T00:00:00-05:00' }
    expect(assessFact(asValidThrough, eveningBefore, POLICY).display).toBe('show')
    expect(assessFact(asValidThrough, new Date('2026-10-31T23:59:00-05:00'), POLICY).display).toBe('show')
    expect(assessFact(asValidThrough, new Date('2026-11-01T00:00:00-05:00'), POLICY).display).toBe('withhold')
  })

  it('an expiry ten days away is plain fresh (there is no pre-expiry state)', () => {
    const f: DatedFact = { id: 'x', checkedAt: '2026-10-10', expiresAt: '2026-10-20', source: 's' }
    expect(assessFact(f, new Date('2026-10-10T12:00:00Z'), POLICY)).toMatchObject({ level: 'fresh', display: 'show' })
  })

  it('expiresAt null is invalid, and null policy or a null row throws', () => {
    expect(assessFact({ id: 'n', checkedAt: '2026-10-10', expiresAt: null as unknown as string, source: 's' }, NOW, POLICY).level).toBe('invalid')
    expect(() => assessFact({ id: 'n', checkedAt: '2026-10-10', source: 's', policy: null as unknown as FactPolicy }, NOW, POLICY)).toThrow(TypeError)
    expect(() => assessFacts([null as unknown as DatedFact], NOW, POLICY)).toThrow(TypeError)
  })

  it('a missing or non-string id is echoed as an empty string', () => {
    const a = assessFact({ checkedAt: '2026-10-10', source: 's' } as unknown as DatedFact, NOW, POLICY)
    expect(a).toMatchObject({ id: '', level: 'fresh' })
  })

  it('boundary on the defaults is not a policy field and changes nothing', () => {
    const f: DatedFact = { id: 'b', checkedAt: '2026-10-01', expiresAt: '2026-10-10T23:07:00Z', source: 's' }
    const withBoundaryOnDefaults = { ...POLICY, boundary: 'exclusive' } as unknown as FactPolicy
    expect(assessFact(f, NOW, withBoundaryOnDefaults).level).toBe('expired')
    expect(assessFact({ ...f, boundary: 'exclusive' }, NOW, POLICY).level).toBe('fresh')
  })

  it('the stale label reads like a fresh one unless the caller supplies severity wording', () => {
    const f: DatedFact = { id: 'x', checkedAt: '2026-07-01', source: 's' }
    const plain = assessFact(f, NOW, { warnAfterDays: 14, staleAfterDays: 45 })
    expect(plain).toMatchObject({ level: 'stale', display: 'caveat', label: 'Checked 101 days ago' })
    const worded = assessFact(f, NOW, { warnAfterDays: 14, staleAfterDays: 45 }, {
      stale: (age) => `May be out of date: checked ${String(age)} days ago`,
    })
    expect(worded.label).toBe('May be out of date: checked 101 days ago')
  })
})
