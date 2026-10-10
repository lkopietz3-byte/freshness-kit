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
 * `id` and `reviewedOn` may be class getters or inherited properties; they are
 * read once and returned as plain fields.
 * The library does not check that `id` is present or unique.
 */
export interface FreshnessRecord {
  id: string
  reviewedOn: string
}

/**
 * A FreshnessRecord after assessFreshness has been run against it. The
 * computed `result` replaces any caller field of that name; read the verdict
 * from `result.level`, not from a caller extra such as `level`.
 */
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
   * The single oldest record driving `level`: the largest `ageDays`, with
   * equal whole-day ages broken by the earlier exact review time, then input
   * order. `undefined` for an empty dataset; there is no oldest record in a
   * dataset with no records.
   */
  oldest: EvaluatedFreshnessRecord | undefined
  /** Every input record, each with its own computed result, in input order. */
  records: EvaluatedFreshnessRecord[]
}

// ---------------------------------------------------------------------------
// Request-time facts (assessFact). See README "Request-time facts".
// ---------------------------------------------------------------------------

/**
 * The verdict for one dated fact.
 *
 * fresh, aging, stale: the three age levels of `FreshnessLevel`.
 * expired: the fact's own `expiresAt` has been reached. Always withheld.
 * invalid: the fact's data cannot be trusted (blank source, unreadable or
 *          future date, no policy). Always withheld.
 */
export type FactLevel = FreshnessLevel | 'expired' | 'invalid'

/**
 * What a caller should do with the fact right now.
 *
 * show: render it as is.
 * caveat: render it with a visible "last checked" note.
 * withhold: do not render it; show nothing or a "no current data" state.
 */
export type FactDisplay = 'show' | 'caveat' | 'withhold'

/**
 * `FreshnessConfig` plus one switch: what a 'stale' fact does. The default is
 * 'caveat' (stale facts are still shown, with a caveat). Set 'withhold' for
 * facts where a stale value is worse than no value, such as a price.
 */
export interface FactPolicy extends FreshnessConfig {
  staleDisplay?: 'caveat' | 'withhold'
}

/**
 * One fact with its own check date, source and optional deadline.
 *
 * `checkedAt` and `expiresAt` use the kit's date grammar: `YYYY-MM-DD` (UTC
 * midnight) or an ISO timestamp with seconds and an explicit timezone.
 * Everything in the data (`checkedAt`, `expiresAt`, `source`) may be any
 * runtime value: a bad value gives an 'invalid' assessment, never a throw.
 * `policy` and `boundary` are configuration: a wrong type throws TypeError.
 */
export interface DatedFact {
  id: string
  checkedAt: string
  /** Where the fact came from. Missing or blank makes the fact 'invalid'. */
  source: string
  /** Deadline. At or after it (see `boundary`) the fact is 'expired'. */
  expiresAt?: string
  /** This fact's thresholds. Replaces the `defaults` thresholds for this fact. */
  policy?: FactPolicy
  /**
   * Whether exactly `expiresAt` counts as expired. 'inclusive' (the default):
   * the fact is withheld AT the instant. 'exclusive': it is still shown AT
   * the instant and withheld from the next millisecond.
   */
  boundary?: 'inclusive' | 'exclusive'
}

/** The verdict for one fact. */
export interface FactAssessment {
  /** The fact's id, echoed ('' when the id was not a string). */
  id: string
  level: FactLevel
  display: FactDisplay
  /** Whole days since `checkedAt`. `null` when the fact is 'invalid'. */
  ageDays: number | null
  /** A plain-language explanation for logs and admin screens. */
  reason: string
  /** A short reader-facing string such as "Checked 3 days ago". */
  label: string
}

/**
 * A function that turns an age and a check date into a label for one level.
 * `ageDays` is `null` for 'invalid'. `checkedAt` is '' when the fact had no
 * string date. It must return a string, otherwise the assessment throws
 * TypeError.
 */
export type FactLabelFn = (ageDays: number | null, checkedAt: string) => string

/** Caller-supplied label overrides, one per level. Unlisted levels use the defaults. */
export type FactLabels = Partial<Record<FactLevel, FactLabelFn>>

/** The roll-up of `assessFacts`. */
export interface FactsAssessment {
  /** Every input fact's assessment, in input order. */
  results: FactAssessment[]
  /**
   * The least trustworthy result (invalid, then expired, stale, aging, fresh);
   * the first one in input order on a tie. `null` for an empty list.
   */
  worst: FactAssessment | null
  /** How many results landed on each level. Every level is present. */
  counts: Record<FactLevel, number>
}
