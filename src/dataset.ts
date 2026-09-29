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
 * `oldest` is the record with the largest `ageDays`; when several share it,
 * the first of them in input order. With one shared config the level never
 * decreases as age grows, so that record always also has the worst level.
 *
 * An empty `records` array returns `level: 'fresh'` and `oldest: undefined`
 * — there is nothing stale about a dataset with nothing in it. That is not
 * proof that the records you expected are present.
 *
 * Every input is read once, up front: `config`, `messages` and `now` once
 * each, and every slot of `records` in a single indexed pass. Each entry is
 * copied (own enumerable properties, so extra fields survive), and the copy is
 * what is validated, assessed and returned. Later changes to the caller's
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
    snapshot.push({ ...entry } as FreshnessRecord)
  }

  // Classify every record before any message callback runs.
  const classified = snapshot.map((record) => ({ record, ...classify(record.reviewedOn, context) }))

  const evaluated: EvaluatedFreshnessRecord[] = classified.map(({ record, level, ageDays }) => ({
    ...record,
    result: {
      level,
      ageDays,
      reviewedOn: record.reviewedOn,
      message: renderMessage(level, ageDays, record.reviewedOn, fns),
    },
  }))

  let oldest: EvaluatedFreshnessRecord | undefined
  for (const record of evaluated) {
    if (oldest === undefined || record.result.ageDays > oldest.result.ageDays) oldest = record
  }

  return {
    level: oldest?.result.level ?? 'fresh',
    oldest,
    records: evaluated,
  }
}
