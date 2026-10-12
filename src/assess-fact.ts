import {
  dayCount,
  isAheadOfClock,
  isPlainObject,
  levelForAge,
  parseReviewedOn,
  readNow,
  readThresholds,
  typeName,
  wholeDaysBetween,
} from './freshness.js'
import type { FreshnessThresholds } from './freshness.js'
import type {
  DatedFact,
  FactAssessment,
  FactDisplay,
  FactLabelFn,
  FactLabels,
  FactLevel,
  FactPolicy,
  FactsAssessment,
} from './types.js'

const FACT_LEVELS: readonly FactLevel[] = ['fresh', 'aging', 'stale', 'expired', 'invalid']
/** Least to most worrying. Used to pick `worst`. */
const SEVERITY: Record<FactLevel, number> = { fresh: 0, aging: 1, stale: 2, expired: 3, invalid: 4 }

/** A policy after validation: thresholds read once, with the stale switch. */
interface ReadPolicy {
  thresholds: FreshnessThresholds
  staleDisplay: 'caveat' | 'withhold' | undefined
}

/** Validated policies by object identity, for one public call. */
type PolicyCache = Map<object, ReadPolicy>

type FactLabelFns = Partial<Record<FactLevel, FactLabelFn>>

/** The label shown for each kind of invalid fact. */
type InvalidCause = 'source' | 'date' | 'other'

/** Internal: the clock, brand-checked. A bad clock is a programmer error, so TypeError. */
function readClock(now: Date): number {
  try {
    return readNow(now)
  } catch (cause) {
    throw new TypeError('assessFact: now must be a valid Date.', { cause })
  }
}

/**
 * Internal: validate a policy once. `undefined` means "none". Anything else
 * must be an object with the two thresholds as numbers: a wrong type is a
 * TypeError, an out-of-range number is the kit's usual RangeError.
 */
function readPolicy(
  value: FactPolicy | undefined,
  where: string,
  cache: PolicyCache,
): ReadPolicy | undefined {
  if (value === undefined) return undefined
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${where} must be an object with warnAfterDays and staleAfterDays, or undefined (received ${typeName(value)}).`)
  }
  // One snapshot per policy object per call: a policy shared by many facts, or
  // passed as both `defaults` and a fact policy, is read and validated once, so
  // a stateful getter cannot give identical facts different verdicts.
  const cached = cache.get(value)
  if (cached !== undefined) return cached
  const read = readPolicyFields(value, where)
  cache.set(value, read)
  return read
}

function readPolicyFields(value: FactPolicy, where: string): ReadPolicy {
  const warnAfterDays: unknown = value.warnAfterDays
  const staleAfterDays: unknown = value.staleAfterDays
  const staleDisplay: unknown = value.staleDisplay
  if (typeof warnAfterDays !== 'number' || typeof staleAfterDays !== 'number') {
    throw new TypeError(`${where}.warnAfterDays and ${where}.staleAfterDays must be numbers.`)
  }
  if (staleDisplay !== undefined && staleDisplay !== 'caveat' && staleDisplay !== 'withhold') {
    throw new TypeError(`${where}.staleDisplay must be 'caveat', 'withhold' or undefined.`)
  }
  return {
    thresholds: readThresholds({ warnAfterDays, staleAfterDays }),
    staleDisplay,
  }
}

function readLabels(labels: FactLabels | undefined): FactLabelFns {
  const fns = Object.create(null) as FactLabelFns
  if (labels === undefined) return fns
  if (!isPlainObject(labels)) {
    throw new TypeError(`assessFact: labels must be a plain object of label functions, or undefined (received ${typeName(labels)}).`)
  }
  for (const level of FACT_LEVELS) {
    const fn: unknown = Object.hasOwn(labels, level) ? labels[level] : undefined
    if (fn === undefined) continue
    if (typeof fn !== 'function') {
      throw new TypeError(`labels.${level} must be a function (received ${typeName(fn)}).`)
    }
    fns[level] = fn as FactLabelFn
  }
  return fns
}

/** Everything read from one fact object, each field exactly once. */
interface FactSnapshot {
  readable: boolean
  id: unknown
  checkedAt: unknown
  source: unknown
  expiresAt: unknown
  policy: unknown
  boundary: unknown
}

const UNREADABLE: FactSnapshot = {
  readable: false,
  id: '',
  checkedAt: undefined,
  source: undefined,
  expiresAt: undefined,
  policy: undefined,
  boundary: undefined,
}

function snapshot(fact: DatedFact): FactSnapshot {
  if (fact === null || typeof fact !== 'object') {
    throw new TypeError(`assessFact: a fact must be an object (received ${typeName(fact)}).`)
  }
  let isArray: boolean
  try {
    isArray = Array.isArray(fact)
  } catch {
    // A revoked proxy throws from Array.isArray: damaged data, not a reason to crash a request.
    return UNREADABLE
  }
  if (isArray) throw new TypeError('assessFact: a fact must be an object (received array).')
  // Fields are read in order, once each. If a later read throws, the id read
  // before the failure is kept so the result still identifies the fact.
  let id: unknown = ''
  try {
    id = fact.id
    return {
      readable: true,
      id,
      checkedAt: fact.checkedAt,
      source: fact.source,
      expiresAt: fact.expiresAt,
      policy: fact.policy,
      boundary: fact.boundary,
    }
  } catch {
    // A throwing getter or revoked proxy is damaged data, not a reason to crash a request.
    return { ...UNREADABLE, id }
  }
}

const ACCEPTED_DATES =
  'Accepted: YYYY-MM-DD or YYYY-MM-DDTHH:mm:ss[.sss] followed by Z or an offset like +00:00.'

// Loose enough to recognize the common near-misses (database timestamps, git
// dates, partial times) so the reason can name what is wrong with them.
const LOOSE_DATE =
  /^(\d{4})-(\d{2})-(\d{2})(?:([Tt ])(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?( ?)(Z|z|[+-]\d{2}(?::?\d{2})?)?)?$/

/**
 * Internal: say which part of a rejected date is wrong. The grammar itself
 * stays strict (`parseReviewedOn` decides); this only explains a rejection so
 * an adopter can fix the input or write a normalizer. Never throws.
 */
function explainDate(field: string, value: unknown): string {
  if (typeof value !== 'string') {
    return `${field} is not a string (received ${typeName(value)}). ${ACCEPTED_DATES}`
  }
  if (value === '') return `${field} is empty. ${ACCEPTED_DATES}`
  const problems: string[] = []
  if (value.trim() !== value) problems.push('it has leading or trailing whitespace')
  const text = value.trim()
  if (/^\d{4}(?:-\d{2})?$/.test(text)) {
    problems.push('it is a partial date (a year or a month only), so give a full YYYY-MM-DD and choose the day yourself')
  } else {
    const m = LOOSE_DATE.exec(text)
    if (m === null) {
      problems.push('it is not an ISO date or timestamp')
    } else {
      const [, y, mo, d, sep, hh, , ss, fraction, gap, zone] = m
      if (sep === 't') problems.push('use an uppercase T between the date and the time')
      if (sep === ' ') problems.push('it has a space between the date and the time (use T)')
      if (hh !== undefined) {
        if (ss === undefined) problems.push('it has no seconds')
        if (fraction !== undefined && fraction.length > 3) {
          problems.push(`it has ${fraction.length} fractional digits (at most 3 are accepted, so round to milliseconds or drop the fraction)`)
        }
        if (zone === undefined) {
          problems.push('it has no timezone (add Z or an offset like +00:00)')
        } else {
          if (zone === 'z') problems.push('use an uppercase Z')
          if (gap === ' ') problems.push('it has a space before the offset')
          if (/^[+-]\d{4}$/.test(zone)) problems.push(`the offset needs a colon (${zone.slice(0, 3)}:${zone.slice(3)}, not ${zone})`)
          if (/^[+-]\d{2}$/.test(zone)) problems.push(`the offset needs minutes and a colon (${zone}:00, not ${zone})`)
        }
      }
      const year = Number(y)
      const month = Number(mo)
      const day = Number(d)
      const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
      const monthDays = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
      if (month < 1 || month > 12 || day < 1 || day > monthDays[month - 1]!) {
        problems.push('it is not a real calendar date')
      }
      if (problems.length === 0) {
        problems.push('a time or offset is out of range (hours 00-23, minutes and seconds 00-59, offset hours 00-23)')
      }
    }
  }
  return `${field} is not a valid date: ${problems.join('; ')}. ${ACCEPTED_DATES}`
}

function defaultLabel(level: FactLevel, ageDays: number | null, cause: InvalidCause): string {
  switch (level) {
    case 'fresh':
    case 'aging':
    case 'stale':
      return ageDays === 0 ? 'Checked today' : `Checked ${dayCount(ageDays ?? 0)} ago`
    case 'expired':
      return 'Expired'
    case 'invalid':
      return cause === 'source' ? 'Source unknown' : cause === 'date' ? 'Date unknown' : 'Unverified'
  }
}

/** A verdict before its label is rendered. Holds no caller object, so no callback can change it. */
interface Pending {
  id: string
  level: FactLevel
  display: FactDisplay
  ageDays: number | null
  reason: string
  checkedAt: string
  cause: InvalidCause
}

function build(
  id: string,
  level: FactLevel,
  display: FactDisplay,
  ageDays: number | null,
  reason: string,
  checkedAt: string,
  cause: InvalidCause = 'other',
): Pending {
  return { id, level, display, ageDays, reason, checkedAt, cause }
}

/** Run last, after every fact has been read and judged: label callbacks never see a half-assessed list. */
function render(pending: Pending, fns: FactLabelFns): FactAssessment {
  const { id, level, display, ageDays, reason, checkedAt, cause } = pending
  const custom = fns[level]
  let label: string
  if (custom === undefined) {
    label = defaultLabel(level, ageDays, cause)
  } else {
    const out: unknown = custom(ageDays, checkedAt)
    if (typeof out !== 'string') {
      throw new TypeError(`labels.${level} must return a string (received ${typeName(out)}).`)
    }
    label = out
  }
  return { id, level, display, ageDays, reason, label }
}

function assessOne(
  fact: DatedFact,
  current: number,
  defaults: ReadPolicy | undefined,
  cache: PolicyCache,
): Pending {
  const snap = snapshot(fact)
  const id = typeof snap.id === 'string' ? snap.id : ''
  const checkedAtText = typeof snap.checkedAt === 'string' ? snap.checkedAt : ''
  const invalid = (reason: string, cause: InvalidCause): Pending =>
    build(id, 'invalid', 'withhold', null, reason, checkedAtText, cause)

  // Configuration first: a wrong type here is a programmer error and throws,
  // whatever the data looks like.
  const policy = snap.readable ? readPolicy(snap.policy as FactPolicy | undefined, 'fact.policy', cache) : undefined
  const boundary: unknown = snap.boundary
  if (boundary !== undefined && boundary !== 'inclusive' && boundary !== 'exclusive') {
    throw new TypeError(`fact.boundary must be 'inclusive', 'exclusive' or undefined (received ${typeName(boundary)}).`)
  }

  // Data next: every failure fails closed.
  if (!snap.readable) return invalid('The fact could not be read.', 'other')
  if (typeof snap.source !== 'string' || snap.source.trim() === '') {
    return invalid('The source is missing or blank, so the fact cannot be attributed.', 'source')
  }
  let checked: { instant: number; dateOnly: boolean }
  try {
    if (typeof snap.checkedAt !== 'string') throw new RangeError('not a string')
    checked = parseReviewedOn(snap.checkedAt)
  } catch {
    return invalid(explainDate('checkedAt', snap.checkedAt), 'date')
  }
  let expiresInstant: number | undefined
  if (snap.expiresAt !== undefined) {
    try {
      if (typeof snap.expiresAt !== 'string') throw new RangeError('not a string')
      expiresInstant = parseReviewedOn(snap.expiresAt).instant
    } catch {
      return invalid(explainDate('expiresAt', snap.expiresAt), 'date')
    }
  }
  if (isAheadOfClock(checked, current)) {
    return invalid(
      'checkedAt is in the future beyond the allowed clock grace (14 hours for a bare date, none for a timestamp).',
      'date',
    )
  }

  const ageDays = wholeDaysBetween(checked.instant, current)

  if (expiresInstant !== undefined) {
    const expired = boundary === 'exclusive' ? current > expiresInstant : current >= expiresInstant
    if (expired) {
      return build(
        id,
        'expired',
        'withhold',
        ageDays,
        `Expired: now is ${boundary === 'exclusive' ? 'after' : 'at or after'} expiresAt ${snap.expiresAt as string}.`,
        checkedAtText,
      )
    }
  }

  const thresholds = policy?.thresholds ?? defaults?.thresholds
  if (thresholds === undefined) {
    return invalid('No freshness policy: set fact.policy or pass defaults, so the age cannot be judged.', 'other')
  }
  const level = levelForAge(ageDays, thresholds)
  if (level === 'fresh') {
    return build(id, level, 'show', ageDays, `Checked ${dayCount(ageDays)} ago, within ${dayCount(thresholds.warnAfterDays)}.`, checkedAtText)
  }
  if (level === 'aging') {
    return build(id, level, 'caveat', ageDays, `Checked ${dayCount(ageDays)} ago, past ${dayCount(thresholds.warnAfterDays)}.`, checkedAtText)
  }
  const staleDisplay = policy?.staleDisplay ?? defaults?.staleDisplay ?? 'caveat'
  return build(
    id,
    level,
    staleDisplay,
    ageDays,
    `Checked ${dayCount(ageDays)} ago, past ${dayCount(thresholds.staleAfterDays)}.`,
    checkedAtText,
  )
}

/**
 * Judge one dated fact at request time. It answers "may I show this?" and
 * never throws because of bad data.
 *
 * Order of checks, first match wins:
 * 1. A missing or blank `source`, an unparseable `checkedAt` or `expiresAt`,
 *    or a `checkedAt` in the future beyond the kit's grace (14 hours for a
 *    bare date, none for a timestamp) gives level 'invalid', display
 *    'withhold'. This fails closed. For an unparseable date the `reason`
 *    names what is wrong (fraction digits, separator, timezone, offset form,
 *    partial date); the grammar itself is not widened.
 * 2. `expiresAt` reached gives 'expired' and 'withhold'. `boundary` picks
 *    whether exactly-at counts: 'inclusive' (the default) withholds AT the
 *    instant, 'exclusive' shows AT it and withholds from the next
 *    millisecond. A bare-date `expiresAt` is UTC midnight at the start of that
 *    date.
 * 3. No thresholds (neither `fact.policy` nor `defaults`) gives 'invalid'.
 * 4. Otherwise the age gives 'fresh' (show), 'aging' (caveat) or 'stale'
 *    (caveat, or withhold when the policy's `staleDisplay` is 'withhold').
 *    Boundaries are the kit's usual: inclusive thresholds on floored whole
 *    days.
 *
 * `fact.policy` replaces `defaults` thresholds for that fact. `staleDisplay`
 * falls back field by field: fact policy, then defaults, then 'caveat'.
 *
 * `labels` reuses the kit's messages pattern for the short `label`.
 *
 * @throws {TypeError} for programmer errors: `now` not a valid Date, a fact
 *   that is not an object, a policy, defaults, `staleDisplay`, `boundary` or
 *   `labels` of the wrong type, or a label function that returns a non-string.
 * @throws {RangeError} for thresholds that are numbers but out of range
 *   (negative, fractional, or warnAfterDays above staleAfterDays).
 */
export function assessFact(
  fact: DatedFact,
  now: Date,
  defaults?: FactPolicy,
  labels?: FactLabels,
): FactAssessment {
  const current = readClock(now)
  const cache: PolicyCache = new Map()
  const readDefaults = readPolicy(defaults, 'defaults', cache)
  const fns = readLabels(labels)
  return render(assessOne(fact, current, readDefaults, cache), fns)
}

/**
 * Judge many facts against one clock and one set of defaults. Each fact gets
 * the same verdict `assessFact` would give it. `facts` must be an array
 * without holes; `results` keeps input order. See `FactsAssessment`.
 */
export function assessFacts(
  facts: readonly DatedFact[],
  now: Date,
  defaults?: FactPolicy,
  labels?: FactLabels,
): FactsAssessment {
  const current = readClock(now)
  if (!Array.isArray(facts)) {
    throw new TypeError(`assessFacts: facts must be an array (received ${typeName(facts)}).`)
  }
  const cache: PolicyCache = new Map()
  const readDefaults = readPolicy(defaults, 'defaults', cache)
  const fns = readLabels(labels)
  // One indexed pass: `.map` would skip a hole.
  const length = facts.length
  const list: DatedFact[] = []
  for (let i = 0; i < length; i++) {
    if (!Object.hasOwn(facts, i)) throw new TypeError(`assessFacts: facts[${i}] is a hole in a sparse array.`)
    list.push(facts[i] as DatedFact)
  }
  // Judge every fact before any label callback runs: a callback cannot change a later verdict,
  // and a bad policy on a later fact throws before any callback has run.
  const pending = list.map((fact) => assessOne(fact, current, readDefaults, cache))
  const results = pending.map((p) => render(p, fns))
  const counts: Record<FactLevel, number> = { fresh: 0, aging: 0, stale: 0, expired: 0, invalid: 0 }
  let worst: FactAssessment | null = null
  for (const result of results) {
    counts[result.level] += 1
    if (worst === null || SEVERITY[result.level] > SEVERITY[worst.level]) worst = result
  }
  return { results, worst, counts }
}
