import type {
  FreshnessConfig,
  FreshnessLevel,
  FreshnessMessageFn,
  FreshnessMessages,
  FreshnessResult,
} from './types.js'

const MS_PER_DAY = 86_400_000

/** Internal validation, also used for an empty dataset. */
export function validateFreshnessContext(config: FreshnessConfig, now: Date): void {
  if (
    !Number.isSafeInteger(config.warnAfterDays) || config.warnAfterDays < 0 ||
    !Number.isSafeInteger(config.staleAfterDays) || config.staleAfterDays < config.warnAfterDays
  ) {
    throw new RangeError('Freshness thresholds must be non-negative safe integers with warnAfterDays <= staleAfterDays.')
  }
  validateNow(now)
}

function validateNow(now: Date): number {
  const timestamp = now.getTime()
  if (!Number.isFinite(timestamp)) throw new RangeError('Freshness now must be a valid Date.')
  return timestamp
}

function parseReviewedOn(reviewedOn: string): number {
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
  const timestamp = Date.parse(match[4] === undefined ? `${reviewedOn}T00:00:00Z` : reviewedOn)
  if (!Number.isFinite(timestamp)) throw new RangeError('reviewedOn must be a valid date.')
  return timestamp
}

/**
 * Whole days between `reviewedOn` and `now`, computed in UTC, floored, never
 * negative.
 *
 * Throws RangeError for malformed, impossible or future review dates, or
 * an invalid clock. Bare dates mean UTC midnight; timestamps require an
 * explicit timezone. No invalid input is converted to age zero.
 */
export function ageInDays(reviewedOn: string, now: Date = new Date()): number {
  const current = validateNow(now)
  const then = parseReviewedOn(reviewedOn)
  if (then > current) throw new RangeError('reviewedOn must not be in the future.')
  return Math.floor((current - then) / MS_PER_DAY)
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
 * Throws RangeError for invalid thresholds, date input or clock; callers
 * must surface an unavailable warning or fail their gate, not substitute fresh.
 */
export function assessFreshness(
  reviewedOn: string,
  config: FreshnessConfig,
  messages?: FreshnessMessages,
  now: Date = new Date(),
): FreshnessResult {
  validateFreshnessContext(config, now)
  const ageDays = ageInDays(reviewedOn, now)
  const level: FreshnessLevel =
    ageDays > config.staleAfterDays ? 'stale' : ageDays > config.warnAfterDays ? 'aging' : 'fresh'

  const messageFn = messages?.[level] ?? defaultMessages[level]
  const message = messageFn(ageDays, reviewedOn)

  return { level, ageDays, reviewedOn, message }
}
