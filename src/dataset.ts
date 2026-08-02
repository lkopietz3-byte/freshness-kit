import type {
  DatasetFreshnessResult,
  EvaluatedFreshnessRecord,
  FreshnessConfig,
  FreshnessLevel,
  FreshnessMessages,
  FreshnessRecord,
} from './types.js'
import { assessFreshness } from './freshness.js'

const LEVEL_RANK: Record<FreshnessLevel, number> = { fresh: 0, aging: 1, stale: 2 }

/**
 * Batch version of assessFreshness for a whole dataset of records that each
 * carry their own reviewed-on date — the generic form of "the oldest record
 * across N rows drives the page-level warning." One config is applied to
 * every record; the result rolls up to a single worst-case level a caller
 * can gate a build on, while still returning every per-record result so a
 * caller can instead (or also) flag individual rows.
 *
 * Ties for "worst" are broken by largest ageDays, so `oldest` is always the
 * single most-stale record, not just an arbitrary one sharing its level.
 *
 * An empty `records` array returns `level: 'fresh'` and `oldest: undefined`
 * — there is nothing stale about a dataset with nothing in it.
 */
export function checkDatasetFreshness(
  records: FreshnessRecord[],
  config: FreshnessConfig,
  messages?: FreshnessMessages,
  now: Date = new Date(),
): DatasetFreshnessResult {
  const evaluated: EvaluatedFreshnessRecord[] = records.map((record) => ({
    ...record,
    result: assessFreshness(record.reviewedOn, config, messages, now),
  }))

  let oldest: EvaluatedFreshnessRecord | undefined
  for (const record of evaluated) {
    if (
      !oldest ||
      LEVEL_RANK[record.result.level] > LEVEL_RANK[oldest.result.level] ||
      (LEVEL_RANK[record.result.level] === LEVEL_RANK[oldest.result.level] &&
        record.result.ageDays > oldest.result.ageDays)
    ) {
      oldest = record
    }
  }

  return {
    level: oldest?.result.level ?? 'fresh',
    oldest,
    records: evaluated,
  }
}
