import { describe, expect, it } from 'vitest'
import { ageInDays, assessFreshness, checkDatasetFreshness } from '../src/index.js'

const NOW = new Date('2026-08-02T12:00:00Z')
const CONFIG = { warnAfterDays: 14, staleAfterDays: 45 }

// The public types forbid all of this, but dates and configs routinely arrive
// from JSON, forms and untyped callers. Every wrong type must come out as the
// one documented error (RangeError), never a TypeError from deep inside, and
// never a coerced value that happens to look like a date.
describe('a wrong type is rejected with RangeError, never coerced or crashed on', () => {
  it.each([
    ['an array holding a date string', ['2026-07-01']],
    ['a String object', new String('2026-07-01')],
    ['a Date object', new Date('2026-07-01T00:00:00Z')],
    ['a number', 20260701],
    ['null', null],
    ['undefined', undefined],
    ['a plain object', {}],
  ])('reviewedOn as %s', (_label, value) => {
    const reviewedOn = value as unknown as string
    expect(() => ageInDays(reviewedOn, NOW)).toThrow(RangeError)
    expect(() => assessFreshness(reviewedOn, CONFIG, undefined, NOW)).toThrow(RangeError)
    expect(() => checkDatasetFreshness([{ id: 'a', reviewedOn }], CONFIG, undefined, NOW)).toThrow(RangeError)
  })

  it.each([
    ['undefined', undefined],
    ['null', null],
    ['a number', 45],
    ['a string', '14/45'],
  ])('config as %s', (_label, value) => {
    const config = value as unknown as typeof CONFIG
    expect(() => assessFreshness('2026-07-01', config, undefined, NOW)).toThrow(RangeError)
    expect(() => checkDatasetFreshness([], config, undefined, NOW)).toThrow(RangeError)
  })

  it.each([
    ['null', null],
    ['epoch milliseconds', NOW.getTime()],
    ['an ISO string', '2026-08-02T12:00:00Z'],
    ['a plain object', {}],
    ['a Date-shaped object', { getTime: () => NOW.getTime() }],
  ])('now as %s', (_label, value) => {
    const now = value as unknown as Date
    expect(() => ageInDays('2026-07-01', now)).toThrow(RangeError)
    expect(() => assessFreshness('2026-07-01', CONFIG, undefined, now)).toThrow(RangeError)
    expect(() => checkDatasetFreshness([], CONFIG, undefined, now)).toThrow(RangeError)
  })

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['a string', 'not an array'],
    ['a plain object', {}],
  ])('records as %s', (_label, value) => {
    const records = value as unknown as [] // deliberately the wrong type
    expect(() => checkDatasetFreshness(records, CONFIG, undefined, NOW)).toThrow(RangeError)
  })

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['a string', '2026-07-01'],
  ])('a dataset entry that is %s', (_label, value) => {
    const records = [{ id: 'ok', reviewedOn: '2026-07-01' }, value] as unknown as []
    expect(() => checkDatasetFreshness(records, CONFIG, undefined, NOW)).toThrow(RangeError)
  })
})
