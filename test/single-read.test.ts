import { describe, expect, it, vi } from 'vitest'
import { ageInDays, assessFreshness, checkDatasetFreshness } from '../src/index.js'
import type { FreshnessConfig, FreshnessRecord } from '../src/index.js'

const NOW = new Date('2026-08-02T12:00:00Z')

// Every value the caller hands over is read exactly once per public call, and
// that one read is what gets validated, computed on and returned. Getters,
// proxies and message callbacks that change the input between reads must not
// be able to make the result disagree with what was checked.

/** A config whose fields count reads and, after the first read, change their answer. */
function shiftyConfig(): { config: FreshnessConfig; reads: () => { warn: number; stale: number } } {
  let warn = 0
  let stale = 0
  const config = {
    get warnAfterDays(): number {
      warn++
      return warn === 1 ? 14 : 0
    },
    get staleAfterDays(): number {
      stale++
      return stale === 1 ? 45 : 0
    },
  }
  return { config, reads: () => ({ warn, stale }) }
}

describe('config is read once', () => {
  it('for checkDatasetFreshness, whatever the number of records', () => {
    const { config, reads } = shiftyConfig()
    const rows: FreshnessRecord[] = [
      { id: 'a', reviewedOn: '2026-07-13' }, // 20 days
      { id: 'b', reviewedOn: '2026-07-13' },
      { id: 'c', reviewedOn: '2026-07-13' },
    ]
    const dataset = checkDatasetFreshness(rows, config, undefined, NOW)
    expect(reads()).toEqual({ warn: 1, stale: 1 })
    // The first read (14 / 45) classifies every record; later reads would say stale.
    expect(dataset.records.map((r) => r.result.level)).toEqual(['aging', 'aging', 'aging'])
  })

  it('for assessFreshness', () => {
    const { config, reads } = shiftyConfig()
    const result = assessFreshness('2026-07-13', config, undefined, NOW)
    expect(reads()).toEqual({ warn: 1, stale: 1 })
    expect(result.level).toBe('aging')
  })

  it('for an empty dataset too', () => {
    const { config, reads } = shiftyConfig()
    checkDatasetFreshness([], config, undefined, NOW)
    expect(reads()).toEqual({ warn: 1, stale: 1 })
  })
})

describe('the clock is read once per call', () => {
  class CountingClock extends Date {
    reads = 0
    override getTime(): number {
      this.reads++
      return super.getTime()
    }
  }
  const config = { warnAfterDays: 14, staleAfterDays: 45 }

  it('by ageInDays', () => {
    const clock = new CountingClock(NOW)
    ageInDays('2026-07-13', clock)
    expect(clock.reads).toBe(1)
  })

  it('by assessFreshness', () => {
    const clock = new CountingClock(NOW)
    assessFreshness('2026-07-13', config, undefined, clock)
    expect(clock.reads).toBe(1)
  })

  it('by checkDatasetFreshness, so every record is aged against the same instant', () => {
    const clock = new CountingClock(NOW)
    const rows: FreshnessRecord[] = [
      { id: 'a', reviewedOn: '2026-07-13' },
      { id: 'b', reviewedOn: '2026-07-13' },
    ]
    checkDatasetFreshness(rows, config, undefined, clock)
    expect(clock.reads).toBe(1)
  })

  it('rejects a Date that cannot report its time with RangeError, not TypeError', () => {
    const proxied = new Proxy(new Date(NOW), {}) // instanceof Date, but getTime() throws
    expect(() => ageInDays('2026-07-13', proxied)).toThrow(RangeError)
    expect(() => checkDatasetFreshness([], config, undefined, proxied)).toThrow(RangeError)
  })

  it('rejects a Date subclass whose getTime returns a non-number', () => {
    class Lying extends Date {
      override getTime(): number {
        return '1785672000000' as unknown as number
      }
    }
    expect(() => ageInDays('2026-07-13', new Lying(NOW))).toThrow(RangeError)
  })
})

describe('each record is read once and copied', () => {
  const config = { warnAfterDays: 14, staleAfterDays: 45 }

  it('reads id and reviewedOn once, and returns exactly what it assessed', () => {
    let reviewedOnReads = 0
    let idReads = 0
    const row = {
      get id(): string {
        idReads++
        return `id-${idReads}`
      },
      get reviewedOn(): string {
        reviewedOnReads++
        return reviewedOnReads === 1 ? '2026-07-13' : '2026-01-01'
      },
    }
    const dataset = checkDatasetFreshness([row], config, undefined, NOW)
    expect(reviewedOnReads).toBe(1)
    expect(idReads).toBe(1)
    const [entry] = dataset.records
    expect(entry?.reviewedOn).toBe('2026-07-13')
    expect(entry?.result.reviewedOn).toBe('2026-07-13')
    expect(entry?.result.ageDays).toBe(20)
    expect(entry?.id).toBe('id-1')
  })

  it('reads the records array length and each index once', () => {
    const reads = new Map<string, number>()
    const rows: FreshnessRecord[] = [
      { id: 'a', reviewedOn: '2026-07-13' },
      { id: 'b', reviewedOn: '2026-07-14' },
    ]
    const proxied = new Proxy(rows, {
      get(target, key, receiver): unknown {
        reads.set(String(key), (reads.get(String(key)) ?? 0) + 1)
        return Reflect.get(target, key, receiver) as unknown
      },
    })
    const dataset = checkDatasetFreshness(proxied, config, undefined, NOW)
    expect(dataset.records).toHaveLength(2)
    expect(reads.get('length')).toBe(1)
    expect(reads.get('0')).toBe(1)
    expect(reads.get('1')).toBe(1)
  })

  it('is not disturbed by a message callback that rewrites the input mid-run', () => {
    const rows: FreshnessRecord[] = [
      { id: 'a', reviewedOn: '2026-07-13' },
      { id: 'b', reviewedOn: '2026-07-13' },
      { id: 'c', reviewedOn: '2026-07-13' },
    ]
    const liveConfig = { warnAfterDays: 14, staleAfterDays: 45 }
    const aging = vi.fn(() => {
      // Sabotage everything the caller still holds.
      const second = rows[1]
      if (second) second.reviewedOn = 'garbage'
      rows.length = 0
      liveConfig.staleAfterDays = 15
      liveConfig.warnAfterDays = 0
      return 'note'
    })
    const dataset = checkDatasetFreshness(rows, liveConfig, { aging }, NOW)
    expect(aging).toHaveBeenCalledTimes(3)
    expect(dataset.records.map((r) => [r.id, r.reviewedOn, r.result.level])).toEqual([
      ['a', '2026-07-13', 'aging'],
      ['b', '2026-07-13', 'aging'],
      ['c', '2026-07-13', 'aging'],
    ])
  })

  it('reads the messages object once per call', () => {
    let reads = 0
    const messages = {
      get aging(): () => string {
        reads++
        return () => 'note'
      },
    }
    const rows: FreshnessRecord[] = [
      { id: 'a', reviewedOn: '2026-07-13' },
      { id: 'b', reviewedOn: '2026-07-13' },
    ]
    checkDatasetFreshness(rows, config, messages, NOW)
    expect(reads).toBe(1)
  })
})

describe('an invalid record stops the run before any message callback fires', () => {
  const config = { warnAfterDays: 14, staleAfterDays: 45 }

  it('when a later record has a bad date', () => {
    const aging = vi.fn(() => 'note')
    const rows: FreshnessRecord[] = [
      { id: 'a', reviewedOn: '2026-07-13' },
      { id: 'b', reviewedOn: 'not-a-date' },
    ]
    expect(() => checkDatasetFreshness(rows, config, { aging }, NOW)).toThrow(RangeError)
    expect(aging).not.toHaveBeenCalled()
  })
})
