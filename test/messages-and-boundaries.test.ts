import { describe, expect, it } from 'vitest'
import { ageInDays, assessFreshness, checkDatasetFreshness } from '../src/index.js'
import type { FreshnessMessages, FreshnessRecord } from '../src/index.js'

const NOW = new Date('2026-08-02T12:00:00Z')
const CONFIG = { warnAfterDays: 14, staleAfterDays: 45 }

// Each rejection says what was wrong. These pin the wording of every error a
// caller can hit, so an empty or swapped message is caught, and they keep the
// format check (the regex) and the calendar check from being loosened.

describe('every rejection says what was wrong', () => {
  it.each([
    ['config is null', () => assessFreshness('2026-07-13', null as never, undefined, NOW), /config must be an object/],
    ['config is a number', () => assessFreshness('2026-07-13', 45 as never, undefined, NOW), /config must be an object/],
    ['a threshold is NaN', () => assessFreshness('2026-07-13', { warnAfterDays: NaN, staleAfterDays: 45 }, undefined, NOW), /thresholds must be non-negative safe integers/],
    ['thresholds are reversed', () => assessFreshness('2026-07-13', { warnAfterDays: 45, staleAfterDays: 14 }, undefined, NOW), /warnAfterDays <= staleAfterDays/],
    ['now is a number', () => ageInDays('2026-07-13', 1 as never), /now must be a valid Date/],
    ['now is an Invalid Date', () => ageInDays('2026-07-13', new Date(NaN)), /now must be a valid Date/],
    ['reviewedOn is a number', () => ageInDays(20260713 as never, NOW), /reviewedOn must be a string/],
    ['reviewedOn has the wrong format', () => ageInDays('07/13/2026', NOW), /YYYY-MM-DD or an ISO timestamp/],
    ['reviewedOn is not a real date', () => ageInDays('2026-02-30', NOW), /real calendar date|valid date/],
    ['reviewedOn is in the future', () => ageInDays('2026-09-01', NOW), /must not be in the future/],
    ['records is not an array', () => checkDatasetFreshness({} as never, CONFIG, undefined, NOW), /records must be an array/],
  ])('%s', (_label, run, message) => {
    expect(run).toThrow(RangeError)
    expect(run).toThrow(message)
  })

  it('keeps the underlying error as the cause when the clock cannot report its time', () => {
    const proxied = new Proxy(new Date(NOW), {})
    let caught: unknown
    try {
      ageInDays('2026-07-13', proxied)
    } catch (error) {
      caught = error
    }
    expect(caught).toBeInstanceOf(RangeError)
    expect((caught as RangeError).message).toMatch(/now must be a valid Date/)
    expect((caught as RangeError).cause).toBeInstanceOf(TypeError)
  })

  it.each([
    ['null', null],
    ['a string', 'x'],
    ['a number', 7],
    ['a boolean', false],
  ])('names the index and the wrong entry when a dataset record is %s', (_label, entry) => {
    const rows = [{ id: 'ok', reviewedOn: '2026-07-13' }, entry] as unknown as FreshnessRecord[]
    expect(() => checkDatasetFreshness(rows, CONFIG, undefined, NOW)).toThrow(/records\[1\] must be an object/)
  })

  it.each([
    ['a Map', new Map()],
    ['a Set', new Set()],
    ['an array', []],
    ['a Date', new Date(NOW)],
  ])('rejects a config that is %s (it has no thresholds)', (_label, config) => {
    expect(() => assessFreshness('2026-07-13', config as never, undefined, NOW)).toThrow(RangeError)
    expect(() => checkDatasetFreshness([], config as never, undefined, NOW)).toThrow(RangeError)
  })

  it.each([
    ['undefined', undefined, 'undefined'],
    ['null', null, 'null'],
    ['a number', 62, 'number'],
    ['an object', {}, 'object'],
  ])('names the type a bad callback result had: %s', (_label, value, typeName) => {
    const messages = { stale: () => value } as unknown as FreshnessMessages
    expect(() => assessFreshness('2026-06-01', CONFIG, messages, NOW)).toThrow(new RegExp(`received ${typeName}\\)`))
  })

  it.each([
    ['null', null, 'null'],
    ['a string', 'stale', 'string'],
    ['a number', 1, 'number'],
  ])('names the type a bad messages argument had: %s', (_label, value, typeName) => {
    expect(() => assessFreshness('2026-06-01', CONFIG, value as never, NOW)).toThrow(new RegExp(`received ${typeName}\\)`))
  })

  it('names the type a non-function override had', () => {
    expect(() => assessFreshness('2026-06-01', CONFIG, { stale: null } as never, NOW)).toThrow(/received null\)/)
    expect(() => assessFreshness('2026-06-01', CONFIG, { stale: 'x' } as never, NOW)).toThrow(/received string\)/)
  })
})

describe('the format check is anchored and exact', () => {
  it.each([
    'x2026-07-13',
    '2026-07-13x',
    '2026-07-13T00:00:00Zjunk',
    'junk2026-07-13T00:00:00Z',
    '2026-07-13T00:00:00+0200',
    '2026-07-13T00:00:00+2400',
    '2026-07-13T00:00:00+20:60',
    '2026-07-13T00:00:00-24:00',
    '2026-07-13T00:00:00+30:00',
  ])('rejects %j at the format check, not later', (value) => {
    expect(() => ageInDays(value, NOW)).toThrow(/YYYY-MM-DD or an ISO timestamp/)
  })

  // Local 12:00 on Jul 31 at each offset, as an instant, against now = Aug 2 12:00Z.
  it.each([
    ['2026-07-31T12:00:00+20:00', 2], // instant Jul 30 16:00Z: 2 days 20 hours
    ['2026-07-31T12:00:00+23:59', 2], // instant Jul 30 12:01Z: 2 days 23 hours 59 minutes
    ['2026-07-31T12:00:00-23:59', 1], // instant Aug 1 11:59Z: 1 day 1 minute
  ])('accepts the extreme offset in %s', (value, days) => {
    expect(ageInDays(value, NOW)).toBe(days)
  })
})

describe('calendar boundaries', () => {
  it.each([
    '2026-01-01', '2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30', '2026-05-31', '2026-06-30',
    '2026-07-31', '2025-08-31', '2025-09-30', '2025-10-31', '2025-11-30', '2025-12-01', '2025-12-31',
    '2024-02-29', '2000-02-29', '0001-01-01',
  ])('accepts the real date %s', (value) => {
    expect(ageInDays(value, NOW)).toBeGreaterThan(0)
  })

  it.each([
    '2026-00-10', '2026-13-01', '2026-01-00', '2026-01-32', '2026-02-29', '2026-02-30', '2026-03-32',
    '2026-04-31', '2026-06-31', '2026-09-31', '2026-11-31', '2025-12-32', '1900-02-29', '2100-02-29',
  ])('rejects the impossible date %s', (value) => {
    expect(() => ageInDays(value, NOW)).toThrow(RangeError)
  })
})

describe('the oldest record of a tie is the first one', () => {
  it('keeps the first of equally old records as oldest', () => {
    const dataset = checkDatasetFreshness(
      [
        { id: 'first', reviewedOn: '2026-06-01' },
        { id: 'second', reviewedOn: '2026-06-01' },
        { id: 'younger', reviewedOn: '2026-07-01' },
      ],
      CONFIG,
      undefined,
      NOW,
    )
    expect(dataset.oldest?.id).toBe('first')
    expect(dataset.oldest).toBe(dataset.records[0])
  })

  it('picks the oldest even when it comes last', () => {
    const dataset = checkDatasetFreshness(
      [
        { id: 'a', reviewedOn: '2026-07-20' },
        { id: 'b', reviewedOn: '2026-07-01' },
        { id: 'c', reviewedOn: '2026-06-01' },
      ],
      CONFIG,
      undefined,
      NOW,
    )
    expect(dataset.oldest?.id).toBe('c')
    expect(dataset.level).toBe('stale')
  })

  it('reports the level of the oldest record when all are aging', () => {
    const dataset = checkDatasetFreshness([{ id: 'a', reviewedOn: '2026-07-13' }], CONFIG, undefined, NOW)
    expect(dataset.level).toBe('aging')
  })
})
