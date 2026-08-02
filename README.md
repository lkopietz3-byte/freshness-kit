# freshness-kit

A tiny, zero-dependency library that makes staleness self-announcing.
Instead of relying on someone remembering to re-check a page and manually
adding a caveat, you attach a `reviewedOn` date to your data, declare two
thresholds, and this library turns the age into an honest, reader-facing
signal automatically — every time the page renders, not just when someone
happens to notice the data is old.

## The idea, plainly

Most products that show verified-at-a-point-in-time data — an offer, a
price, a fact sheet, a directory listing, a benchmark, a score — degrade
silently. The underlying facts drift out of date, but the page doesn't know
that happened. It just keeps rendering the same content with the same
visual confidence it had on day one. Nothing forces anyone to notice; the
page doesn't get more wrong loudly, it just sits there, still published,
quietly stale.

The fix this library encodes: store a `reviewedOn` date next to the data
(not buried in a commit message or a changelog nobody reads), declare two
thresholds in days, and compute a level — `'fresh' | 'aging' | 'stale'` —
every time the page renders. Each level maps to a different amount of
honesty:

- **fresh** — render nothing. The data is current enough not to need a
  caveat.
- **aging** — a quiet note. The data is probably still fine, but a careful
  reader should know it isn't brand new.
- **stale** — a prominent, visible warning. Do not let a reader assume this
  is current.

**dbt's source-freshness feature is the fair, well-known comparison here** —
`warn_after` / `error_after` thresholds on a source table, with a non-zero
exit code past `error_after` that fails a pipeline run. The core mechanism
(declared thresholds, a warn tier and a harder tier past it) is not new and
this library doesn't pretend otherwise: dbt has been gating builds on
declared source-freshness thresholds for years, and if all you need is "fail
CI when data is too old," dbt's `freshness:` block already does that well.
What's more specific to this pattern is applying the same threshold idea to
individual **dataset or record** freshness with a **three-state,
reader-facing degradation** — silent when fresh, a quiet note when aging, a
prominent visible warning when stale — rather than only failing a build
pipeline. A dbt freshness check protects the warehouse; this library
protects the page a person is actually looking at, whether or not anything
upstream ever re-runs.

## Install

```bash
npm install
npm test           # vitest
npm run typecheck  # tsc --noEmit
npm run build       # emits dist/ (ESM + .d.ts)
```

Zero runtime dependencies. ESM only (`"type": "module"`). MIT licensed.

## Example: a single piece of data

Say a product page shows a fact that someone verifies by hand every so
often — a spec sheet, a price, a policy summary. You know the date it was
last checked; you don't want the page to keep showing it with a straight
face forever.

```ts
import { assessFreshness, type FreshnessConfig } from 'freshness-kit'

const config: FreshnessConfig = {
  warnAfterDays: 14,
  staleAfterDays: 45,
}

const result = assessFreshness('2026-06-01', config)
// {
//   level: 'stale',
//   ageDays: 62,
//   reviewedOn: '2026-06-01',
//   message: 'This information was last checked 62 days ago and may be
//             out of date. Verify before relying on it.'
// }

if (result.level !== 'fresh') {
  console.log(result.message)
}
```

The default messages are deliberately generic — "This information was last
checked N days ago" — so they read sensibly regardless of what the data
actually is. Override any subset of them with your own copy:

```ts
const result = assessFreshness('2026-06-01', config, {
  stale: (ageDays) =>
    `Last verified ${ageDays} days ago. Prices change often — confirm the
     current number before you rely on this.`,
  // 'aging' and 'fresh' fall back to the generic defaults, unchanged.
})
```

## Example: a whole dataset

If you have many records that each carry their own `reviewedOn` date — rows
in a directory, entries in a catalog, cities in a comparison table —
`checkDatasetFreshness` applies one config to all of them and rolls the
result up to a single worst-case level, while still returning every
per-record result:

```ts
import { checkDatasetFreshness } from 'freshness-kit'

const dataset = checkDatasetFreshness(
  [
    { id: 'omaha', reviewedOn: '2026-07-20' },
    { id: 'lisbon', reviewedOn: '2026-05-02' },
    { id: 'austin', reviewedOn: '2026-07-30' },
  ],
  { warnAfterDays: 14, staleAfterDays: 45 },
)

dataset.level // 'stale' — driven by 'lisbon'
dataset.oldest?.id // 'lisbon'
dataset.records // all three, each with its own { id, reviewedOn, result }
```

Use `dataset.level` to gate a whole build (fail CI, or show a site-wide
banner), and `dataset.records` to flag individual rows instead — or both.

## Rendering a badge

`freshnessBadgeText` is a tiny, pure, framework-agnostic helper that turns a
`FreshnessResult` into a short string. It returns plain text only — wrap it
in whatever your UI actually is (a `<span>`, a Slack message, a CLI line):

```ts
import { freshnessBadgeText } from 'freshness-kit'

freshnessBadgeText(result) // 'Stale — last updated 62d ago'
```

## Running this as a CI check

```ts
// scripts/check-freshness.ts
import { checkDatasetFreshness } from 'freshness-kit'
import { records } from '../src/data/catalog.js' // wherever yours live

const dataset = checkDatasetFreshness(records, { warnAfterDays: 14, staleAfterDays: 45 })

if (dataset.level === 'stale') {
  console.error(
    `Stale data: ${dataset.oldest?.id} was last reviewed ${dataset.oldest?.result.ageDays} days ago.`,
  )
  process.exit(1)
}
```

This mirrors dbt's `error_after` gate, but nothing about this library
requires you to fail a build — the same `assessFreshness` /
`checkDatasetFreshness` calls work identically at render time on a live
page. Use one, the other, or both with the same config so the CI gate and
what a reader sees never disagree about whether the data is current.

## Honest limits

- **This computes staleness from a `reviewedOn` date you supply. It cannot
  verify that the underlying data is still accurate.** A record with a
  `reviewedOn` of yesterday reads as `'fresh'` here even if the fact it
  describes changed an hour after it was checked. This library only ever
  answers "how long has it been since someone looked at this," never "is
  this still true." Verifying the content itself is a separate,
  domain-specific problem this library deliberately does not attempt.
- **`reviewedOn` is only as honest as whoever sets it.** Nothing stops a
  person (or a script) from bumping the date without actually re-checking
  anything. A fresh-looking date next to stale content isn't caught by
  anything in this library — pair it with a real review process, not just
  a field that's easy to touch.
- **No scheduling, no notifications, no storage.** `assessFreshness` and
  `checkDatasetFreshness` are pure functions of the inputs you pass them.
  There's no cron, no webhook, no database. Bring your own trigger (a CI
  step, a page render, a scheduled task in whatever system you already
  use) and your own place to store `reviewedOn` dates.
- **An unparsable `reviewedOn` is treated as 0 days old, not an error.**
  `ageInDays` is a pure date-math helper, not a validator — it won't throw
  on a malformed string, it will just (silently) read as brand new. If you
  need to catch a bad date, validate it yourself before calling in (e.g.
  `Number.isNaN(Date.parse(reviewedOn))`) — see cityplanr's
  `last_verified is a valid date and never in the future` test for the
  shape of that check.
- **Two thresholds, one level ordering.** This library only supports the
  fresh → aging → stale progression with two thresholds. If you need more
  tiers, different tiers per record type, or non-linear rules, you'll need
  to build on top of `ageInDays` directly rather than use `assessFreshness`
  as-is.

## Files

```
src/
  types.ts       FreshnessLevel, FreshnessConfig, FreshnessResult,
                  FreshnessMessages, FreshnessRecord, DatasetFreshnessResult
  freshness.ts    ageInDays, assessFreshness
  dataset.ts      checkDatasetFreshness
  badge.ts        freshnessBadgeText
  index.ts        Barrel export
test/
  freshness.test.ts   Boundary values, message overrides, dataset roll-up
```
