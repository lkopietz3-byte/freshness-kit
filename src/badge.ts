import type { FreshnessResult } from './types.js'

/**
 * A tiny, framework-agnostic helper for rendering a FreshnessResult as a
 * short badge string. Returns plain text only — no JSX, no HTML, no CSS
 * classes. Wrap the returned string in whatever your UI layer is (a
 * `<span>`, a Slack message, a CLI line, a `<Badge>` component) yourself.
 *
 * 'fresh' returns an empty string, matching `FreshnessResult.message`: the
 * honest default is to render nothing when there's nothing to say. 'aging'
 * returns `Reviewed 20d ago`; 'stale' returns `Stale — last reviewed 62d ago`
 * (the em dash is U+2014). The wording says "reviewed", not "updated", because
 * the input is a review date: a review can confirm content that never changed.
 *
 * This formatter trusts a result from assessFreshness/checkDatasetFreshness;
 * it does not validate manually constructed or deserialized result objects.
 * Reassess the original review date instead of persisting and re-rendering a
 * stored result.
 */
export function freshnessBadgeText(result: FreshnessResult): string {
  switch (result.level) {
    case 'fresh':
      return ''
    case 'aging':
      return `Reviewed ${result.ageDays}d ago`
    case 'stale':
      return `Stale — last reviewed ${result.ageDays}d ago`
  }
}
