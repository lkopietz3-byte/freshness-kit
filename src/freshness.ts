import type {
  FreshnessConfig,
  FreshnessLevel,
  FreshnessMessageFn,
  FreshnessMessages,
  FreshnessResult,
} from './types.js'

const MS_PER_DAY = 86_400_000
// UTC+14:00 (for example Pacific/Kiritimati) is the furthest-ahead civil time
// zone offset in the IANA database. See the future-date rule on ageInDays.
const MAX_UTC_OFFSET_MS = 14 * 3_600_000

/**
 * The caller's config and clock, each read exactly once and validated. Every
 * later step uses these values, never the caller's objects, so a getter, proxy
 * or Date subclass that answers differently on a second read cannot make the
 * result disagree with what was validated.
 */
export interface FreshnessContext {
  readonly warnAfterDays: number
  readonly staleAfterDays: number
  /** The clock as epoch milliseconds. */
  readonly current: number
}

/** Internal: validate `config` and `now` (also used for an empty dataset) and snapshot them. */
export function readFreshnessContext(config: FreshnessConfig, now: Date): FreshnessContext {
  // Reject a missing or non-object config before reading its fields: a
  // property access on `null`/`undefined` throws TypeError, not our
  // documented RangeError.
  if (config === null || typeof config !== 'object') {
    throw new RangeError('Freshness config must be an object with warnAfterDays and staleAfterDays.')
  }
  const warnAfterDays: unknown = config.warnAfterDays
  const staleAfterDays: unknown = config.staleAfterDays
  if (
    !Number.isSafeInteger(warnAfterDays) || (warnAfterDays as number) < 0 ||
    !Number.isSafeInteger(staleAfterDays) || (staleAfterDays as number) < (warnAfterDays as number)
  ) {
    throw new RangeError('Freshness thresholds must be non-negative safe integers with warnAfterDays <= staleAfterDays.')
  }
  return {
    warnAfterDays: warnAfterDays as number,
    staleAfterDays: staleAfterDays as number,
    current: readNow(now),
  }
}

function readNow(now: Date): number {
  // `instanceof Date` first: a plain number, string, or duck-typed
  // `{ getTime() }` object must not slip through property-access coercion
  // (calling a missing `.getTime` throws TypeError, not our RangeError; a
  // Date-shaped fake would otherwise pass silently).
  if (!(now instanceof Date)) throw new RangeError('Freshness now must be a valid Date.')
  let timestamp: unknown
  try {
    // One read. A Proxy around a Date passes `instanceof` but throws here.
    timestamp = now.getTime()
  } catch (cause) {
    throw new RangeError('Freshness now must be a valid Date.', { cause })
  }
  if (typeof timestamp !== 'number' || !Number.isFinite(timestamp)) {
    throw new RangeError('Freshness now must be a valid Date.')
  }
  return timestamp
}

function parseReviewedOn(reviewedOn: string): { instant: number; dateOnly: boolean } {
  // A non-string must be rejected before it reaches the regex: RegExp#exec
  // coerces its argument with ToString, so a one-element array or a boxed
  // `String` object would otherwise stringify into a lookalike date and be
  // silently accepted instead of rejected.
  if (typeof reviewedOn !== 'string') {
    throw new RangeError('reviewedOn must be a string in YYYY-MM-DD or ISO timestamp format.')
  }
  // Restrict the input to an unambiguous calendar date or explicitly zoned
  // timestamp. Date.parse alone normalizes impossible days such as Feb 30.
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:T([01]\d|2[0-3]):([0-5]\d):([0-5]\d)(?:\.\d{1,3})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d))?$/.exec(reviewedOn)
  if (!match) throw new RangeError('reviewedOn must be YYYY-MM-DD or an ISO timestamp with seconds and an explicit timezone.')
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
  if (month < 1 || month > 12 || day < 1 || day > days[month - 1]!) {
    throw new RangeError('reviewedOn must be a real calendar date.')
  }
  const dateOnly = match[4] === undefined
  const instant = Date.parse(dateOnly ? `${reviewedOn}T00:00:00Z` : reviewedOn)
  if (!Number.isFinite(instant)) throw new RangeError('reviewedOn must be a valid date.')
  return { instant, dateOnly }
}

/**
 * Whole days between `reviewedOn` and `now`, computed in UTC, floored, never
 * negative.
 *
 * Throws RangeError for malformed, impossible or future review dates, or
 * an invalid clock. Bare dates mean UTC midnight; timestamps require an
 * explicit timezone. No invalid input is converted to age zero.
 *
 * Future dates: a timestamp is an exact instant and is rejected if it is
 * even one millisecond after `now`. A bare date has no zone, so it is
 * rejected only when it is later than today in every time zone (that is,
 * when its UTC midnight is more than 14 hours after `now`); a bare date that
 * is already today in UTC+14 is accepted and reads as age 0. This keeps a
 * reviewer who types their local date from being rejected for part of the day.
 */
export function ageInDays(reviewedOn: string, now: Date = new Date()): number {
  return ageAt(reviewedOn, readNow(now))
}

/** Internal: `ageInDays` against a clock that is already validated and read. */
function ageAt(reviewedOn: string, current: number): number {
  const { instant, dateOnly } = parseReviewedOn(reviewedOn)
  const latestAllowed = dateOnly ? current + MAX_UTC_OFFSET_MS : current
  if (instant > latestAllowed) throw new RangeError('reviewedOn must not be in the future.')
  return Math.max(0, Math.floor((current - instant) / MS_PER_DAY))
}

const LEVELS: readonly FreshnessLevel[] = ['fresh', 'aging', 'stale']

const defaultMessages: Record<FreshnessLevel, FreshnessMessageFn> = {
  fresh: () => '',
  aging: (ageDays) => `This information was last checked ${ageDays} days ago.`,
  stale: (ageDays) =>
    `This information was last checked ${ageDays} days ago and may be out of date. Verify before relying on it.`,
}

/** The caller's message overrides after validation: only real functions, read once. */
export type FreshnessMessageFns = Readonly<Partial<Record<FreshnessLevel, FreshnessMessageFn>>>

/** A plain object or a null-prototype object: not an array, Map, Set, Date, RegExp or class instance. */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  try {
    if (typeof value !== 'object' || value === null) return false
    const proto: unknown = Object.getPrototypeOf(value)
    // `Object.getPrototypeOf(proto) === null` also accepts Object.prototype
    // from another realm, whose identity differs from ours.
    return proto === null || Object.getPrototypeOf(proto) === null
  } catch {
    return false // a revoked proxy throws here
  }
}

/** `typeof`, except that null is named as null. Cannot throw, so it is safe inside an error message. */
function typeName(value: unknown): string {
  return value === null ? 'null' : typeof value
}

/**
 * Internal: validate and snapshot the caller's `messages`. `undefined` means
 * "use the defaults"; anything else must be a plain object whose own
 * `fresh`/`aging`/`stale` entries are each `undefined` or a function. A Map, a
 * class instance or `null` would otherwise be read as "no overrides" and
 * silently replaced by the defaults.
 */
export function readMessages(messages: FreshnessMessages | undefined): FreshnessMessageFns {
  // Null-prototype, so reading `fns[level]` later cannot find an inherited entry.
  const fns = Object.create(null) as Partial<Record<FreshnessLevel, FreshnessMessageFn>>
  if (messages === undefined) return fns
  if (!isPlainObject(messages)) {
    throw new RangeError(`Freshness messages must be a plain object of message functions, or undefined (received ${typeName(messages)}).`)
  }
  for (const level of LEVELS) {
    // Own properties only: an inherited `stale` (for example from a polluted
    // Object.prototype) is not a caller override.
    const fn: unknown = Object.hasOwn(messages, level) ? messages[level] : undefined
    if (fn === undefined) continue
    if (typeof fn !== 'function') {
      throw new TypeError(`messages.${level} must be a function (received ${typeName(fn)}).`)
    }
    fns[level] = fn as FreshnessMessageFn
  }
  return fns
}

/** Internal: the level and whole-day age of one review date, against an already-read context. No callbacks run. */
export function classify(reviewedOn: string, context: FreshnessContext): { level: FreshnessLevel; ageDays: number } {
  const ageDays = ageAt(reviewedOn, context.current)
  const level: FreshnessLevel =
    ageDays > context.staleAfterDays ? 'stale' : ageDays > context.warnAfterDays ? 'aging' : 'fresh'
  return { level, ageDays }
}

/** Internal: the reader-facing message for a classified date. The callback must return a string. */
export function renderMessage(
  level: FreshnessLevel,
  ageDays: number,
  reviewedOn: string,
  fns: FreshnessMessageFns,
): string {
  const message: unknown = (fns[level] ?? defaultMessages[level])(ageDays, reviewedOn)
  if (typeof message !== 'string') {
    throw new TypeError(`messages.${level} must return a string (received ${typeName(message)}).`)
  }
  return message
}

/**
 * Compute a FreshnessResult for a single reviewed-on date against a pair of
 * declared thresholds, generating reader-facing copy through
 * caller-overridable message functions (generic defaults are used for any
 * level not overridden).
 *
 * Level boundaries: 'fresh' through and including warnAfterDays, 'aging'
 * from warnAfterDays + 1 through and including staleAfterDays, 'stale' from
 * staleAfterDays + 1 on.
 *
 * `config`, `messages` and `now` are each read once. `messages` must be
 * `undefined` or a plain object whose `fresh`/`aging`/`stale` entries are
 * `undefined` or functions, and the function for the reached level must return
 * a string.
 *
 * @throws {RangeError} for invalid thresholds, date input or clock, or a
 *   `messages` value that is not a plain object. Callers must surface an
 *   unavailable warning or fail their gate, not substitute fresh.
 * @throws {TypeError} when a `messages` entry is not a function, or a message
 *   function returns something other than a string. These are caller-code
 *   bugs, not bad input data.
 */
export function assessFreshness(
  reviewedOn: string,
  config: FreshnessConfig,
  messages?: FreshnessMessages,
  now: Date = new Date(),
): FreshnessResult {
  const context = readFreshnessContext(config, now)
  const fns = readMessages(messages)
  const { level, ageDays } = classify(reviewedOn, context)
  return { level, ageDays, reviewedOn, message: renderMessage(level, ageDays, reviewedOn, fns) }
}
