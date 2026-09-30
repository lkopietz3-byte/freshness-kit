import { describe, expect, it, vi } from 'vitest'
import { assessFreshness, checkDatasetFreshness } from '../src/index.js'
import type { FreshnessMessages, FreshnessRecord } from '../src/index.js'

const NOW = new Date('2026-08-02T12:00:00Z')
const CONFIG = { warnAfterDays: 14, staleAfterDays: 45 }
const FRESH = '2026-07-30' // 3 days
const AGING = '2026-07-13' // 20 days
const STALE = '2026-06-01' // 62 days

function asMessages(value: unknown): FreshnessMessages {
  return value as FreshnessMessages
}

describe('a message callback must return a string (TypeError otherwise)', () => {
  it.each([
    ['undefined', undefined],
    ['null', null],
    ['a number', 62],
    ['a boolean', true],
    ['an object', { text: 'x' }],
    ['a boxed String', new String('x')],
    ['a promise', Promise.resolve('x')],
  ])('rejects a callback that returns %s', (_label, value) => {
    const messages = asMessages({ stale: () => value })
    expect(() => assessFreshness(STALE, CONFIG, messages, NOW)).toThrow(TypeError)
    expect(() => assessFreshness(STALE, CONFIG, messages, NOW)).toThrow(/messages\.stale must return a string/)
    expect(() => checkDatasetFreshness([{ id: 'a', reviewedOn: STALE }], CONFIG, messages, NOW)).toThrow(TypeError)
  })

  it('names the level whose callback misbehaved', () => {
    expect(() => assessFreshness(AGING, CONFIG, asMessages({ aging: () => 1 }), NOW)).toThrow(/messages\.aging/)
    expect(() => assessFreshness(FRESH, CONFIG, asMessages({ fresh: () => 1 }), NOW)).toThrow(/messages\.fresh/)
  })

  it('accepts an empty string and a real string', () => {
    expect(assessFreshness(STALE, CONFIG, { stale: () => '' }, NOW).message).toBe('')
    expect(assessFreshness(STALE, CONFIG, { stale: () => 'careful' }, NOW).message).toBe('careful')
  })

  it('lets a fresh-level override replace the empty default', () => {
    const result = assessFreshness(FRESH, CONFIG, { fresh: (ageDays) => `ok ${ageDays}` }, NOW)
    expect(result.level).toBe('fresh')
    expect(result.message).toBe('ok 3')
  })

  it('propagates an error thrown inside a callback unchanged', () => {
    const boom = new Error('boom')
    expect(() => assessFreshness(STALE, CONFIG, { stale: () => { throw boom } }, NOW)).toThrow(boom)
  })

  it('does not call the callback of a level that is not reached', () => {
    const stale = vi.fn(() => 'x')
    assessFreshness(AGING, CONFIG, { stale }, NOW)
    expect(stale).not.toHaveBeenCalled()
  })
})

describe('an override that is not a function is rejected (TypeError), even for an unreached level', () => {
  it.each([
    ['a string', 'text'],
    ['null', null],
    ['a number', 1],
    ['an object', {}],
  ])('rejects messages.stale as %s', (_label, value) => {
    const messages = asMessages({ stale: value })
    expect(() => assessFreshness(FRESH, CONFIG, messages, NOW)).toThrow(TypeError)
    expect(() => assessFreshness(FRESH, CONFIG, messages, NOW)).toThrow(/messages\.stale must be a function/)
    expect(() => checkDatasetFreshness([], CONFIG, messages, NOW)).toThrow(TypeError)
  })

  it('treats an explicit undefined as "use the default"', () => {
    const result = assessFreshness(AGING, CONFIG, asMessages({ aging: undefined }), NOW)
    expect(result.message).toBe('This information was last checked 20 days ago.')
  })
})

describe('the messages argument must be undefined or a plain object (RangeError otherwise)', () => {
  class WithMethods {
    stale(): string {
      return 'from a class instance'
    }
  }
  const revoked = Proxy.revocable({}, {})
  revoked.revoke()

  it.each([
    ['a Map', new Map([['stale', () => 'x']])],
    ['a Set', new Set()],
    ['an array', []],
    ['a Date', new Date()],
    ['a RegExp', /x/],
    ['a class instance', new WithMethods()],
    ['null', null],
    ['a string', 'stale'],
    ['a number', 1],
    ['a function', () => 'x'],
    ['a revoked proxy', revoked.proxy],
  ])('rejects %s, rather than silently using the defaults', (_label, value) => {
    const messages = asMessages(value)
    expect(() => assessFreshness(STALE, CONFIG, messages, NOW)).toThrow(RangeError)
    expect(() => assessFreshness(STALE, CONFIG, messages, NOW)).toThrow(/messages must be a plain object/)
    expect(() => checkDatasetFreshness([], CONFIG, messages, NOW)).toThrow(RangeError)
  })

  it('accepts a plain object and a null-prototype object', () => {
    const nullProto = Object.assign(Object.create(null) as Record<string, unknown>, { stale: () => 'null-proto' })
    expect(assessFreshness(STALE, CONFIG, { stale: () => 'plain' }, NOW).message).toBe('plain')
    expect(assessFreshness(STALE, CONFIG, asMessages(nullProto), NOW).message).toBe('null-proto')
    expect(assessFreshness(STALE, CONFIG, {}, NOW).level).toBe('stale')
  })

  it('reads only own properties, so a polluted Object.prototype cannot inject copy', () => {
    const polluted = vi.fn(() => 'injected')
    Object.defineProperty(Object.prototype, 'stale', { value: polluted, configurable: true, writable: true })
    try {
      const result = assessFreshness(STALE, CONFIG, {}, NOW)
      expect(result.message).toContain('may be out of date')
      expect(polluted).not.toHaveBeenCalled()
    } finally {
      delete (Object.prototype as unknown as Record<string, unknown>).stale
    }
  })
})

describe('the default messages', () => {
  it('say exactly what the docs show', () => {
    expect(assessFreshness(FRESH, CONFIG, undefined, NOW).message).toBe('')
    expect(assessFreshness(AGING, CONFIG, undefined, NOW).message).toBe(
      'This information was last checked 20 days ago.',
    )
    expect(assessFreshness(STALE, CONFIG, undefined, NOW).message).toBe(
      'This information was last checked 62 days ago and may be out of date. Verify before relying on it.',
    )
  })

  it('pass (ageDays, reviewedOn) to an override', () => {
    const aging = vi.fn((ageDays: number, reviewedOn: string) => `${ageDays} ${reviewedOn}`)
    const rows: FreshnessRecord[] = [{ id: 'a', reviewedOn: AGING }]
    checkDatasetFreshness(rows, CONFIG, { aging }, NOW)
    expect(aging).toHaveBeenCalledWith(20, AGING)
  })
})
