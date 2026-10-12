import type {
  DatasetFreshnessResult,
  EvaluatedFreshnessRecord,
  FreshnessConfig,
  FreshnessMessages,
  FreshnessRecord,
} from './types.js'
import { classify, readFreshnessContext, readMessages, renderMessage } from './freshness.js'

/**
 * Batch version of assessFreshness for a whole dataset of records that each
 * carry their own reviewed-on date — the generic form of "the oldest record
 * across N rows drives the page-level warning." One config is applied to
 * every record; the result rolls up to a single worst-case level a caller
 * can gate a build on, while still returning every per-record result so a
 * caller can instead (or also) flag individual rows.
 *
 * `oldest` is the record with the largest `ageDays`. Records that share the
 * same whole-day age are ordered by their exact review instant, earliest
 * first; if the instants are also equal, the first in input order wins. With
 * one shared config the level never decreases as age grows, so that record
 * always also has the worst level (a tie on `ageDays` has the same level, so
 * the tie-break never changes `level`).
 *
 * Each row is the caller's own extra fields plus `id`, `reviewedOn` and the
 * computed `result`. The computed fields always win: a caller field named
 * `result` is replaced, and a caller field named `level` is just passed
 * through as a caller extra; the computed level is only ever `row.result.level`.
 *
 * An empty `records` array returns `level: 'fresh'` and `oldest: undefined`
 * — there is nothing stale about a dataset with nothing in it. That is not
 * proof that the records you expected are present.
 *
 * Every input is read once, up front: `config`, `messages` and `now` once
 * each, and every slot of `records` in a single indexed pass. Each entry is
 * copied: its own enumerable properties (so extra fields survive) plus `id` and
 * `reviewedOn`, which are each read once with a normal property read, so a
 * class getter or an inherited field works. The copy is what is validated,
 * assessed and returned. Later changes to the caller's
 * objects, including from inside a message callback, cannot affect the result.
 * No message callback runs until every record has been checked, so a rejected
 * dataset produces no callbacks and no partial result.
 *
 * `records` must be a dense array of objects. A hole (a sparse slot), an
 * `undefined` entry, `null` or any non-object throws RangeError naming the
 * index; so does a non-array (including `null`/`undefined`).
 *
 * @throws {RangeError} for invalid thresholds or clock, a `records` value that
 *   is not a dense array of objects, invalid date input in any record, or a
 *   `messages` value that is not a plain object. Thresholds, clock and
 *   `messages` are validated even for an empty array.
 * @throws {TypeError} when a `messages` entry is not a function, or a message
 *   function returns something other than a string.
 */
export function checkDatasetFreshness(
  records: FreshnessRecord[],
  config: FreshnessConfig,
  messages?: FreshnessMessages,
  now: Date = new Date(),
): DatasetFreshnessResult {
  const context = readFreshnessContext(config, now)
  const fns = readMessages(messages)
  if (!Array.isArray(records)) {
    throw new RangeError('records must be an array of { id, reviewedOn } objects.')
  }
  // One indexed pass over every numeric slot, so a hole (which `.map` and
  // `.forEach` skip but `for...of` and spread visit as `undefined`) is
  // rejected instead of skipped.
  const length = records.length
  const snapshot: FreshnessRecord[] = []
  for (let index = 0; index < length; index++) {
    // `hasOwn`, not `in` or a bare read: a hole must not be filled from an
    // inherited Array.prototype entry.
    if (!Object.hasOwn(records, index)) {
      throw new RangeError(`records[${index}] is a hole in a sparse array; every slot must be a { id, reviewedOn } object.`)
    }
    const entry: unknown = records[index]
    if (entry === null || typeof entry !== 'object') {
      throw new RangeError(`records[${index}] must be an object with an id and reviewedOn.`)
    }
    // `id` and `reviewedOn` are read here, once each, with a normal property
    // read, so a class getter or an inherited field works and a getter that
    // changes its answer is only asked once. They are left out of the rest-copy
    // (which reads own enumerable properties), so an own enumerable getter is
    // not read a second time, and are stored on the copy as plain data.
    const { id, reviewedOn, ...rest } = entry as Record<string, unknown>
    const copy = { ...rest, reviewedOn } as Record<string, unknown>
    // Only when the entry has an id at all; a record without one stays without.
    if ('id' in entry) copy.id = id
    snapshot.push(copy as unknown as FreshnessRecord)
  }

  // Classify every record before any message callback runs.
  const classified = snapshot.map((record) => ({ record, ...classify(record.reviewedOn, context) }))

  // Caller extras are spread first so the computed `result` always wins over a
  // caller field of the same name.
  const evaluated: EvaluatedFreshnessRecord[] = classified.map(({ record, level, ageDays }) => ({
    ...record,
    result: {
      level,
      ageDays,
      reviewedOn: record.reviewedOn,
      message: renderMessage(level, ageDays, record.reviewedOn, fns),
    },
  }))

  // Largest whole-day age wins; a tie on whole days goes to the earlier review
  // instant (the exactly older record); a full tie keeps the first in input order.
  let oldest: EvaluatedFreshnessRecord | undefined
  let oldestInstant = Infinity
  evaluated.forEach((record, index) => {
    const instant = classified[index]!.instant
    if (
      oldest === undefined ||
      record.result.ageDays > oldest.result.ageDays ||
      (record.result.ageDays === oldest.result.ageDays && instant < oldestInstant)
    ) {
      oldest = record
      oldestInstant = instant
    }
  })

  return {
    level: oldest?.result.level ?? 'fresh',
    oldest,
    records: evaluated,
  }
}
