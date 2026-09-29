import { describe, expect, it, vi } from 'vitest'
import { checkDatasetFreshness } from '../src/index.js'
import type { FreshnessRecord } from '../src/index.js'

const NOW = new Date('2026-08-02T12:00:00Z')
const CONFIG = { warnAfterDays: 14, staleAfterDays: 45 }
const GOOD: FreshnessRecord = { id: 'a', reviewedOn: '2026-06-01' } // stale, 62 days

/** A sparse array of `length` slots holding real records only at `filled`. */
function holey(length: number, ...filled: number[]): FreshnessRecord[] {
  const rows = new Array(length) as FreshnessRecord[]
  for (const index of filled) rows[index] = GOOD
  return rows
}

// `.map` and `.forEach` skip holes; `for...of` and spread visit them as
// undefined. The dataset check must reject every non-record slot in one
// indexed pass, so no hole can be skipped and no half-assessed result can come
// back (FK-001).
describe('a sparse records array is rejected, never assessed as fresh', () => {
  it('rejects the single-hole array from the FK-001 reproduction', () => {
    expect(() => checkDatasetFreshness(new Array(1) as FreshnessRecord[], CONFIG, undefined, NOW)).toThrow(RangeError)
  })

  it('rejects the trailing-hole array from the FK-001 reproduction with RangeError, not TypeError', () => {
    const rows = new Array(2) as FreshnessRecord[]
    rows[0] = GOOD
    expect(() => checkDatasetFreshness(rows, CONFIG, undefined, NOW)).toThrow(RangeError)
  })

  it.each([
    ['an array literal with a leading hole', () => holey(2, 1)],
    ['a hole in the middle', () => holey(3, 0, 2)],
    ['a trailing hole made by raising length', () => {
      const rows = [GOOD, GOOD]
      rows.length = 3
      return rows
    }],
    ['a hole made by delete', () => {
      const rows = [GOOD, GOOD, GOOD]
      Reflect.deleteProperty(rows, 1)
      return rows
    }],
    ['an all-hole array of three', () => new Array(3) as FreshnessRecord[]],
    ['a huge all-hole array (fails at the first slot, no long scan)', () => new Array(2 ** 32 - 1) as FreshnessRecord[]],
  ])('rejects %s', (_label, build) => {
    expect(() => checkDatasetFreshness(build(), CONFIG, undefined, NOW)).toThrow(RangeError)
  })

  it('names the offending index in the error', () => {
    expect(() => checkDatasetFreshness(holey(3, 0, 2), CONFIG, undefined, NOW)).toThrow(/records\[1\]/)
  })

  it('does not let an inherited Array.prototype entry stand in for a hole', () => {
    const inherited: FreshnessRecord = { id: 'ghost', reviewedOn: '2026-08-01' }
    Object.defineProperty(Array.prototype, 1, { value: inherited, configurable: true, writable: true })
    try {
      const rows = [GOOD] as FreshnessRecord[]
      rows.length = 2
      expect(() => checkDatasetFreshness(rows, CONFIG, undefined, NOW)).toThrow(RangeError)
    } finally {
      delete (Array.prototype as unknown as Record<number, unknown>)[1]
    }
  })

  it('rejects an explicit undefined entry exactly like a hole', () => {
    expect(() => checkDatasetFreshness([undefined] as unknown as FreshnessRecord[], CONFIG, undefined, NOW)).toThrow(RangeError)
  })

  it('runs no message callback when any slot is a hole (no partial assessment)', () => {
    const stale = vi.fn(() => 'x')
    const rows = holey(3, 0, 2)
    expect(() => checkDatasetFreshness(rows, CONFIG, { stale }, NOW)).toThrow(RangeError)
    expect(stale).not.toHaveBeenCalled()
  })

  it('keeps the empty-array contract: fresh, no oldest, no records', () => {
    for (const empty of [[], new Array(0) as FreshnessRecord[]]) {
      const dataset = checkDatasetFreshness(empty, CONFIG, undefined, NOW)
      expect(dataset.level).toBe('fresh')
      expect(dataset.oldest).toBeUndefined()
      expect(dataset.records).toEqual([])
    }
  })

  it('returns a dense records array of the same length and order for dense input', () => {
    const rows: FreshnessRecord[] = [GOOD, { id: 'b', reviewedOn: '2026-08-01' }]
    const dataset = checkDatasetFreshness(rows, CONFIG, undefined, NOW)
    expect(dataset.records).toHaveLength(2)
    expect(Object.keys(dataset.records)).toEqual(['0', '1'])
    expect(dataset.records.map((r) => r.id)).toEqual(['a', 'b'])
  })
})
