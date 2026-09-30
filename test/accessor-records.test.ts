import { describe, expect, it } from 'vitest'
import { assessFreshness, checkDatasetFreshness } from '../src/index.js'
import type { FreshnessConfig } from '../src/index.js'

const NOW = new Date('2026-09-29T10:00:00Z')
const CONFIG: FreshnessConfig = { warnAfterDays: 30, staleAfterDays: 90 }

// A dataset entry is often a class or ORM record: its fields can be prototype
// getters or inherited properties, neither of which an own-property copy keeps.
// Version 0.1.1 read `record.reviewedOn` straight off the entry, so these all
// worked; the copy must read `id` and `reviewedOn` explicitly to keep that.

class Row {
  constructor(
    private readonly rowId: string,
    private readonly date: string,
    readonly note = 'kept',
  ) {}
  get id(): string {
    return this.rowId
  }
  get reviewedOn(): string {
    return this.date
  }
}

describe('records whose fields are prototype getters', () => {
  it('are graded like a plain record with the same values', () => {
    const plain = checkDatasetFreshness([{ id: 'a', reviewedOn: '2026-01-01' }], CONFIG, undefined, NOW)
    const viaClass = checkDatasetFreshness([new Row('a', '2026-01-01')], CONFIG, undefined, NOW)
    expect(viaClass.level).toBe('stale')
    expect(viaClass.records[0]?.result).toEqual(plain.records[0]?.result)
    expect(viaClass.records[0]?.result).toEqual(assessFreshness('2026-01-01', CONFIG, undefined, NOW))
  })

  it('come back with id and reviewedOn as own data properties, plus own extra fields', () => {
    const { records } = checkDatasetFreshness([new Row('a', '2026-09-01')], CONFIG, undefined, NOW)
    const evaluated = records[0]
    expect(evaluated).toBeDefined()
    expect(Object.getOwnPropertyDescriptor(evaluated, 'id')).toMatchObject({ value: 'a', enumerable: true })
    expect(Object.getOwnPropertyDescriptor(evaluated, 'reviewedOn')).toMatchObject({
      value: '2026-09-01',
      enumerable: true,
    })
    expect(evaluated).toHaveProperty('note', 'kept')
    expect(evaluated?.result.level).toBe('fresh')
  })

  it('still reject an invalid getter value with a RangeError', () => {
    expect(() => checkDatasetFreshness([new Row('a', 'not a date')], CONFIG, undefined, NOW)).toThrow(RangeError)
  })

  it('work with a private field behind the getter', () => {
    class Private {
      #date: string
      constructor(date: string) {
        this.#date = date
      }
      get id(): string {
        return 'p'
      }
      get reviewedOn(): string {
        return this.#date
      }
    }
    const result = checkDatasetFreshness([new Private('2026-01-01')], CONFIG, undefined, NOW)
    expect(result.level).toBe('stale')
    expect(result.oldest?.id).toBe('p')
  })
})

describe('records whose fields are inherited', () => {
  it('are read through the prototype chain and stored on the copy', () => {
    const proto = { id: 'inherited-id', reviewedOn: '2026-01-01' }
    const entry = Object.create(proto) as { id: string; reviewedOn: string }
    const { records, level } = checkDatasetFreshness([entry], CONFIG, undefined, NOW)
    expect(level).toBe('stale')
    expect(records[0]?.id).toBe('inherited-id')
    expect(Object.hasOwn(records[0] ?? {}, 'reviewedOn')).toBe(true)
    expect(records[0]?.reviewedOn).toBe('2026-01-01')
  })

  it('let an own field shadow an inherited one', () => {
    const entry = Object.assign(Object.create({ id: 'proto', reviewedOn: '2026-01-01' }) as object, {
      reviewedOn: '2026-09-28',
    })
    const { records } = checkDatasetFreshness([entry as { id: string; reviewedOn: string }], CONFIG, undefined, NOW)
    expect(records[0]?.result.level).toBe('fresh')
    expect(records[0]?.id).toBe('proto')
  })
})

describe('id and reviewedOn are each read exactly once', () => {
  it('when they are prototype getters that change their answer', () => {
    const reads = { id: 0, reviewedOn: 0 }
    const proto = {
      get id(): string {
        return `id-${++reads.id}`
      },
      get reviewedOn(): string {
        // First read is 120 days old; any later read would be fresh.
        return ++reads.reviewedOn === 1 ? '2026-06-01' : '2026-09-29'
      },
    }
    const entry = Object.create(proto) as { id: string; reviewedOn: string }
    const { records, level } = checkDatasetFreshness([entry], CONFIG, undefined, NOW)
    expect(reads).toEqual({ id: 1, reviewedOn: 1 })
    expect(level).toBe('stale')
    expect(records[0]?.id).toBe('id-1')
    expect(records[0]?.reviewedOn).toBe('2026-06-01')
    expect(records[0]?.result.reviewedOn).toBe('2026-06-01')
  })

  it('when they are own enumerable getters (the copy must not read them twice)', () => {
    const reads = { id: 0, reviewedOn: 0 }
    const entry = {
      get id(): string {
        return `id-${++reads.id}`
      },
      get reviewedOn(): string {
        return ++reads.reviewedOn === 1 ? '2026-06-01' : '2026-09-29'
      },
    }
    const { records, level } = checkDatasetFreshness([entry], CONFIG, undefined, NOW)
    expect(reads).toEqual({ id: 1, reviewedOn: 1 })
    expect(level).toBe('stale')
    expect(records[0]?.id).toBe('id-1')
    expect(records[0]?.reviewedOn).toBe('2026-06-01')
  })

  it('and a message callback cannot change the record afterward', () => {
    class Mutable {
      date = '2026-06-01'
      get id(): string {
        return 'm'
      }
      get reviewedOn(): string {
        return this.date
      }
    }
    const row = new Mutable()
    const { records } = checkDatasetFreshness(
      [row],
      CONFIG,
      {
        stale: () => {
          row.date = '2026-09-29'
          return 'stale message'
        },
      },
      NOW,
    )
    expect(records[0]?.reviewedOn).toBe('2026-06-01')
    expect(records[0]?.result.message).toBe('stale message')
  })
})

describe('plain records keep their 0.1.1 shape', () => {
  it('does not invent an id key for a record that has none', () => {
    const { records } = checkDatasetFreshness([{ reviewedOn: '2026-09-01' } as never], CONFIG, undefined, NOW)
    expect(Object.hasOwn(records[0] ?? {}, 'id')).toBe(false)
  })

  it('copies extra own fields and does not alias the caller object', () => {
    const entry = { id: 'a', reviewedOn: '2026-09-01', owner: 'docs' }
    const { records } = checkDatasetFreshness([entry], CONFIG, undefined, NOW)
    expect(records[0]).toMatchObject({ id: 'a', reviewedOn: '2026-09-01', owner: 'docs' })
    expect(records[0]).not.toBe(entry)
    expect(Object.hasOwn(entry, 'result')).toBe(false)
  })

  it('keeps an own __proto__ key as data instead of changing the prototype', () => {
    const entry = JSON.parse('{"id":"a","reviewedOn":"2026-09-01","__proto__":{"polluted":true}}') as {
      id: string
      reviewedOn: string
    }
    const { records } = checkDatasetFreshness([entry], CONFIG, undefined, NOW)
    expect(Object.getPrototypeOf(records[0])).toBe(Object.prototype)
    expect((records[0] as unknown as { polluted?: boolean }).polluted).toBeUndefined()
  })
})
