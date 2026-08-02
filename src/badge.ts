import type { FreshnessResult } from './types.js'

/**
 * A tiny, framework-agnostic helper for rendering a FreshnessResult as a
 * short badge string. Returns plain text only — no JSX, no HTML, no CSS
 * classes. Wrap the returned string in whatever your UI layer is (a
 * `<span>`, a Slack message, a CLI line, a `<Badge>` component) yourself.
 *
 * 'fresh' returns an empty string, matching `FreshnessResult.message`: the
 * honest default is to render nothing when there's nothing to say.
 */
export function freshnessBadgeText(result: FreshnessResult): string {
  switch (result.level) {
    case 'fresh':
      return ''
    case 'aging':
      return `Updated ${result.ageDays}d ago`
    case 'stale':
      return `Stale — last updated ${result.ageDays}d ago`
  }
}
