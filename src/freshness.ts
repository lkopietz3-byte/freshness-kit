import type {
  FreshnessConfig,
  FreshnessLevel,
  FreshnessMessageFn,
  FreshnessMessages,
  FreshnessResult,
} from './types.js'

const MS_PER_DAY = 86_400_000

// A bare calendar date ('2026-07-20') is already UTC midnight per the ISO
// 8601 / Date.parse spec, but appending an explicit UTC time makes that
// non-obvious fact impossible to get wrong on a machine in a non-UTC
// timezone. A string that already carries a time or offset is left alone.
function toParsableIso(dateStr: string): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(dateStr) ? `${dateStr}T00:00:00Z` : dateStr
}

/**
 * Whole days between `reviewedOn` and `now`, computed in UTC, floored, never
 * negative.
 *
 * An unparsable `reviewedOn` is treated as 0 days old rather than throwing —
 * this is a pure formatting/math helper, not a validator. Validate dates
 * before they reach this library if you need to catch malformed input (see
 * the README's Honest limits section).
 */
export function ageInDays(reviewedOn: string, now: Date = new Date()): number {
  const then = Date.parse(toParsableIso(reviewedOn))
  if (Number.isNaN(then)) return 0
  return Math.max(0, Math.floor((now.getTime() - then) / MS_PER_DAY))
}

const defaultMessages: Record<FreshnessLevel, FreshnessMessageFn> = {
  fresh: () => '',
  aging: (ageDays) => `This information was last checked ${ageDays} days ago.`,
  stale: (ageDays) =>
    `This information was last checked ${ageDays} days ago and may be out of date. Verify before relying on it.`,
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
 */
export function assessFreshness(
  reviewedOn: string,
  config: FreshnessConfig,
  messages?: FreshnessMessages,
  now: Date = new Date(),
): FreshnessResult {
  const ageDays = ageInDays(reviewedOn, now)
  const level: FreshnessLevel =
    ageDays > config.staleAfterDays ? 'stale' : ageDays > config.warnAfterDays ? 'aging' : 'fresh'

  const messageFn = messages?.[level] ?? defaultMessages[level]
  const message = messageFn(ageDays, reviewedOn)

  return { level, ageDays, reviewedOn, message }
}
