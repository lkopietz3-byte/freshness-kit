# Freshness Kit

A small TypeScript library that converts a caller-supplied review date and age thresholds into `fresh`, `aging`, or `stale` indicators. It helps a product show how long ago information was reviewed; it does not determine whether that information is still true.

## Start here

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

## When not to use this

- You need to verify the *content* is still correct, not just measure how
  long it's been since someone said they checked it. This library never
  looks at the data itself — see Honest limits below.
- You need more than two thresholds, non-linear tiers, or per-record-type
  rules. Build on `ageInDays` directly instead of `assessFreshness`.
- You already have a warehouse-level freshness gate (dbt's `freshness:`
  block, for example) and only need to fail a pipeline run. That's a narrower,
  more mature problem than this library targets; use this when you also want
  a reader-facing signal at render time, not just a CI exit code.
- Your `reviewedOn` values aren't trustworthy inputs (nobody actually updates
  them). This library can't tell a genuine re-check from a bumped date.

## Install

```bash
npm install freshness-kit
```

Zero runtime dependencies. ESM only (`"type": "module"`). MIT licensed.

To work on this repo itself instead of consuming it:

```bash
npm install
npm test
npm run typecheck
npm run build
```

## Example: a single piece of data

Say a product page shows a fact that someone verifies by hand every so
often — a spec sheet, a price, a policy summary. You know the date it was
last checked; you don't want the page to keep showing it with a straight
face forever.

```ts
import { assessFreshness, type FreshnessConfig } from "freshness-kit";

const config: FreshnessConfig = {
  warnAfterDays: 14,
  staleAfterDays: 45,
};

// The 4th argument is the clock to measure age against; it defaults to
// `new Date()`. It's pinned here so this example's output is exact and
// reproducible — in your own code you'll normally omit it.
const result = assessFreshness('2026-06-01', config, undefined, new Date('2026-08-02T12:00:00Z'))
// {
//   level: 'stale',
//   ageDays: 62,
//   reviewedOn: '2026-06-01',
//   message: 'This information was last checked 62 days ago and may be
//             out of date. Verify before relying on it.'
// }

if (result.level !== "fresh") {
  console.log(result.message);
}
```

The returned `ageDays` depends on the date when the function runs. For example, the original illustrative output of `62` days corresponds to a run **as of 2026-08-02** with `reviewedOn: "2026-06-01"`; it is a dated example, not a value to expect from a run today. The level and message should be computed from the current call result.

Override any subset of the default messages when the UI needs domain-specific wording:

```ts
const resultWithCopy = assessFreshness("2026-06-01", config, {
  stale: (ageDays) =>
    `Last verified ${ageDays} days ago. Confirm the current number before relying on it.`,
});
```

Unspecified messages use the generic defaults.

## Assess a dataset

`checkDatasetFreshness` returns a result for every record and a rolled-up dataset level based on the oldest item.

```ts
import { checkDatasetFreshness } from "freshness-kit";

const dataset = checkDatasetFreshness(
  [
    { id: "omaha", reviewedOn: "2026-07-20" },
    { id: "lisbon", reviewedOn: "2026-05-02" },
    { id: "austin", reviewedOn: "2026-07-30" },
  ],
  { warnAfterDays: 14, staleAfterDays: 45 },
);

console.log(dataset.level); // The least fresh record determines the level.
console.log(dataset.oldest?.id);
console.log(dataset.records); // Each record and its individual result.
```

Use `dataset.level` to gate a whole build (fail CI, or show a site-wide
banner), and `dataset.records` to flag individual rows instead — or both.
If any record has invalid input, the entire call throws `RangeError`; it
does not return a partial dataset or a `fresh` fallback.

## Input contract and migration

`ageInDays`, `assessFreshness`, and `checkDatasetFreshness` reject invalid,
impossible, wrong-typed, and future review dates with `RangeError`. This is
an intentional design decision: an early draft of this library silently
converted malformed or future dates to age zero, which let a bad date hide
a fully stale record behind a `'fresh'` result. Valid inputs keep the same
result types, inclusive thresholds, messages, badges, and dataset ordering.

Accepted strings are a real `YYYY-MM-DD` calendar date (UTC midnight), or
`YYYY-MM-DDTHH:mm:ss[.fraction]Z` / `YYYY-MM-DDTHH:mm:ss[.fraction]±HH:mm`.
Fractions have one to three digits. Hours are 00–23; minutes/seconds 00–59.
Non-ISO formats, surrounding whitespace, a lowercase `t`/`z`, timestamps
without a timezone, missing seconds, 24:00, and leap seconds are all
rejected — as is anything that isn't a JavaScript string, such as an array
or a boxed `String` object, even one that would print as a valid date.

Future dates are handled differently depending on whether the input carries
a time zone. A timestamp with an explicit offset is an exact instant with no
tolerance: it's compared to `now` by instant (so a calendar date printed as
"tomorrow" with an offset like `+14:00` can still resolve to an instant that
isn't in the future), but it throws if that instant is even one millisecond
after `now`. A bare `YYYY-MM-DD` date carries no zone at all, so instead it's
rejected only when it's later than today in *every* civil time zone — that
is, when its UTC midnight is more than 14 hours after `now` (UTC+14 is the
furthest-ahead zone in the IANA database). A bare date that has already
started somewhere on Earth is accepted and reads as age zero; this keeps a
reviewer who types their own local date from being rejected for part of the
day just because UTC hasn't reached that date yet. The supplied `now` must
be an actual `Date` instance with a finite time — a timestamp number, an ISO
string, or a duck-typed `{ getTime() }` object is rejected, not coerced.

Thresholds must be non-negative safe integers with
`warnAfterDays <= staleAfterDays`; zero and equal thresholds are allowed. A
`config` that isn't an object (including `null`/`undefined`) is rejected the
same way. Dataset calls validate thresholds and the clock even for an empty
array, and `records` itself must be an array of objects — a non-array or a
`null`/non-object element throws instead of crashing. An empty valid dataset
still returns `fresh` with no oldest record; that means no stale records
were found, and is not proof that required data exists.

Audit callers that previously relied on permissive parsing or clamping.
In CI, let invalid-input errors fail the process. At a rendering boundary,
show a visible unavailable state when an input check fails; never catch an
error and substitute an empty badge, zero age, or `fresh`:

```ts
let warning: string
try {
  warning = assessFreshness(reviewedOn, config).message
} catch (error) {
  if (!(error instanceof RangeError)) throw error
  warning = 'Review date unavailable. Verify this information before relying on it.'
}
// Render warning as text in the host application's warning area.
```

## API reference

Every export, for quick scanning; see the sections above for behavior in
context and the TSDoc on each symbol for the full contract.

- **`ageInDays(reviewedOn: string, now: Date = new Date()): number`**
  Whole days between `reviewedOn` and `now`, computed in UTC and floored,
  never negative. Throws `RangeError` per the input contract above.
- **`assessFreshness(reviewedOn: string, config: FreshnessConfig, messages?: FreshnessMessages, now: Date = new Date()): FreshnessResult`**
  The main single-record entry point: computes the age and classifies it
  into `'fresh' | 'aging' | 'stale'`, generating `message` through
  `messages` (or the generic default for any level left out).
- **`checkDatasetFreshness(records: FreshnessRecord[], config: FreshnessConfig, messages?: FreshnessMessages, now: Date = new Date()): DatasetFreshnessResult`**
  Runs `assessFreshness` over every record with one shared config and rolls
  the result up to the single worst level, still returning every per-record
  result. Throws on the first invalid record; never returns a partial result.
- **`freshnessBadgeText(result: FreshnessResult): string`**
  Turns a `FreshnessResult` into a short plain-text badge (`''` when fresh).
  Trusts its input — see the badge section below for the trust boundary.
- **Types** — `FreshnessLevel` (`'fresh' | 'aging' | 'stale'`), `FreshnessConfig`
  (`{ warnAfterDays, staleAfterDays }`), `FreshnessResult`
  (`{ level, ageDays, reviewedOn, message }`), `FreshnessMessageFn`
  (`(ageDays, reviewedOn) => string`), `FreshnessMessages` (a `Partial` map
  of `FreshnessMessageFn` by level), `FreshnessRecord` (`{ id, reviewedOn }`),
  `EvaluatedFreshnessRecord` (a `FreshnessRecord` plus its `result`), and
  `DatasetFreshnessResult` (`{ level, oldest, records }`).

## Render a short label

The formatter trusts the result from an assessment. It does not validate
manually constructed or deserialized result objects; reassess the original
review date and config at the current clock instead of trusting stored levels.

```ts
import { freshnessBadgeText } from "freshness-kit";

console.log(freshnessBadgeText(result));
```

The helper returns plain text for you to place in a page, message, or CLI output.

## Run as a CI check

The library does not schedule work. A script can call `checkDatasetFreshness` and fail a build when your data exceeds the policy you chose:

```ts
import { checkDatasetFreshness } from "freshness-kit";
import { records } from "../src/data/catalog.js";

const dataset = checkDatasetFreshness(records, {
  warnAfterDays: 14,
  staleAfterDays: 45,
});

if (dataset.level === "stale") {
  console.error(`Stale data: ${dataset.oldest?.id}`);
  process.exit(1);
}
```

The same assessment can be used when rendering a page. Choose thresholds that fit the data and explain the resulting status to readers.

## Modules

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
- **Invalid input stops the assessment; the host owns the visible error.**
  This library throws rather than inventing an age or returning a fourth
  freshness level that an existing `level === 'stale'` gate could miss.
  Follow the input contract above when adapting existing callers. It does
  not validate that the records array contains every required record.
- **Two thresholds, one level ordering.** This library only supports the
  fresh → aging → stale progression with two thresholds. If you need more
  tiers, different tiers per record type, or non-linear rules, you'll need
  to build on top of `ageInDays` directly rather than use `assessFreshness`
  as-is.
- **The future-date check trusts the `now` you pass it.** The 14-hour bare-
  date allowance covers real time-zone ambiguity, not a general clock-skew
  budget. If the caller's clock itself is wrong by more than that, a
  genuinely future-dated review can still be accepted. Pass a `now` you
  trust (a server clock synced with NTP, not an untrusted client's).

## Relationship to claims-registry-kit

`claims-registry-kit` solves an adjacent problem: whether one claim, backed
by evidence, is still trustworthy enough to call `'current'`. This library
solves a more general one: turning any `reviewedOn` date into a three-level
`fresh` / `aging` / `stale` signal for a page, a record, or a whole dataset,
independent of whether "evidence" is involved at all. If what you have is a
claim with a required evidence link and a single stale/current cutoff,
`claims-registry-kit` is the closer fit; if you have a review date and want
a graduated, reader-facing warning, use this library instead.

The two libraries currently disagree on how much future slack a date gets:
`claims-registry-kit` allows any `verifiedAt` (bare date or full timestamp)
up to a flat 24 hours ahead of `now`, while this library allows a bare date
up to 14 hours ahead (tied to the real UTC+14 time-zone limit) but gives an
explicit-offset timestamp no slack at all. Both are defensible, but a caller
using both kits should not assume they draw the future-date line in the same
place.

## Limits

- The library calculates age from the `reviewedOn` value supplied by the caller. It cannot verify the underlying facts.
- A recent date is only as trustworthy as the review process that recorded it. Bumping the date without checking the information can make stale content look fresh.
- It does not store data, run scheduled reviews, send notifications, or check sources.
- An unparsable date is treated as zero days old by the current implementation. Validate dates at your input boundary if malformed values are possible.
- It supports two thresholds and the `fresh` → `aging` → `stale` progression. Use `ageInDays` directly if your policy needs different tiers.

```
src/
  types.ts       FreshnessLevel, FreshnessConfig, FreshnessResult,
                  FreshnessMessages, FreshnessRecord, DatasetFreshnessResult
  freshness.ts    ageInDays, assessFreshness
  dataset.ts      checkDatasetFreshness
  badge.ts        freshnessBadgeText
  index.ts        Barrel export
test/
  freshness.test.ts     Boundary values, message overrides, dataset roll-up
  invalid-input.test.ts Invalid inputs, offsets, calendars and gate safety
  future-dates.test.ts  The bare-date "today somewhere on Earth" allowance
  wrong-types.test.ts   Wrong runtime types at every entry point
```
