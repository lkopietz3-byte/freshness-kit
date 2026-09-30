// Core types for freshness-kit.
//
// The pattern: any product that shows verified-at-a-point-in-time data (an
// offer, a price, a fact sheet, a score, a directory listing) eventually
// shows it long after nobody has re-checked it. The page doesn't know that
// happened — it just keeps rendering the same content with the same
// confidence, silently. This library makes that silence impossible: every
// piece of data carries a `reviewedOn` date, and a declared pair of
// thresholds turns "how old is this" into a three-state reader-facing signal
// instead of a fact only a build log knows.

/**
 * fresh   — within warnAfterDays. Render nothing; the data is current enough
 *           not to need a caveat.
 * aging   — past warnAfterDays but within staleAfterDays. A quiet note. The
 *           data is still probably fine, but a careful reader should know
 *           it's not brand new.
 * stale   — past staleAfterDays. A prominent, visible warning. Do not let a
 *           reader assume this is current.
 */
export type FreshnessLevel = 'fresh' | 'aging' | 'stale'

/**
 * The two thresholds (non-negative safe integer days) that turn an age
 * into a level. warnAfterDays must not exceed staleAfterDays.
 *
 * `warnAfterDays` is the boundary between 'fresh' and 'aging'; an item is
 * still 'fresh' AT exactly warnAfterDays, and becomes 'aging' the day after.
 * `staleAfterDays` works the same way one tier up: an item is still 'aging'
 * AT exactly staleAfterDays, and becomes 'stale' the day after.
 */
export interface FreshnessConfig {
  warnAfterDays: number
  staleAfterDays: number
}

/** The computed freshness of one reviewed-on date, at a point in time. */
export interface FreshnessResult {
  level: FreshnessLevel
  /** Whole days between `reviewedOn` and the `now` the check ran against. */
  ageDays: number
  /** The reviewed-on date this result was computed from, echoed back. */
  reviewedOn: string
  /** Reader-facing sentence. Empty string when fresh — render nothing. */
  message: string
}

/**
 * A function that turns an age and a reviewed-on date into reader copy for one
 * level. It must return a string (empty is fine); anything else makes the
 * calling assessment throw TypeError.
 */
export type FreshnessMessageFn = (ageDays: number, reviewedOn: string) => string

/**
 * Caller-supplied overrides for the generated message, one per level. Any
 * level left out falls back to this library's generic default for that
 * level — callers only need to override the levels whose copy they actually
 * want to change.
 *
 * Must be a plain object (or null-prototype object); a Map, class instance or
 * `null` is rejected with RangeError. Only own properties are used, and an
 * entry that is present must be a function (`undefined` means "use the
 * default"), otherwise TypeError.
 */
export type FreshnessMessages = Partial<Record<FreshnessLevel, FreshnessMessageFn>>

/**
 * One record in a dataset: whatever identifies it, plus its own reviewed-on
 * date. Extra own enumerable fields are copied through to the evaluated record.
 * The library does not check that `id` is present or unique.
 */
export interface FreshnessRecord {
  id: string
  reviewedOn: string
}

/** A FreshnessRecord after assessFreshness has been run against it. */
export interface EvaluatedFreshnessRecord extends FreshnessRecord {
  result: FreshnessResult
}

/**
 * The result of checking a whole dataset: every record's own result, plus a
 * roll-up a caller can gate a build on without inspecting each record.
 */
export interface DatasetFreshnessResult {
  /** The worst (least fresh) level across every record. 'fresh' for an empty dataset. */
  level: FreshnessLevel
  /**
   * The single oldest record driving `level` (ties broken by largest
   * ageDays). `undefined` for an empty dataset — there is no oldest record
   * in a dataset with no records.
   */
  oldest: EvaluatedFreshnessRecord | undefined
  /** Every input record, each with its own computed result, in input order. */
  records: EvaluatedFreshnessRecord[]
}
