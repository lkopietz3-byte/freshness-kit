# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.3.0] - unreleased

New request-time API (`assessFact`, `assessFacts`), plus two small behavior
changes to existing output.

### Breaking changes

- The default aging and stale messages now say "1 day ago" where they said
  "1 days ago". Migration: if a test, snapshot or string comparison matched the
  old text, update it. A custom message function still receives the plain number.
- `checkDatasetFreshness` can pick a different `oldest` record when two records
  have the same whole-day age: the one with the earlier exact review time now
  wins, where the first in input order won before. Migration: if you relied on
  input order to break such a tie, sort the records first. `dataset.level` and
  every `ageDays` are unchanged.

### Added

- `assessFact(fact, now, defaults?, labels?)` and `assessFacts(facts, now, defaults?, labels?)`:
  a request-time verdict per fact. Each `DatedFact` carries its own `checkedAt`,
  `source`, optional `expiresAt`, optional `policy` and optional `boundary`. The
  result has `level` (`fresh | aging | stale | expired | invalid`), `display`
  (`show | caveat | withhold`), `ageDays`, `reason` and `label`.
  - Bad data never throws. A missing or blank source, an unparseable
    `checkedAt` or `expiresAt`, a `checkedAt` beyond the future grace, or no
    thresholds at all gives `invalid` and `withhold` (fail closed).
  - `expiresAt` reached gives `expired` and `withhold`. `boundary` is
    `'inclusive'` by default (withhold AT the instant) or `'exclusive'`.
  - `fresh` shows, `aging` and `stale` caveat, `expired` and `invalid` withhold.
    A policy can set `staleDisplay: 'withhold'`.
  - Optional per-level label functions reuse the shape of `messages`.
  - Programmer errors (a bad `now`, `facts`, policy or labels) throw `TypeError`.
  - `assessFacts` adds `results`, `worst` and `counts`.
  - New types: `DatedFact`, `FactAssessment`, `FactsAssessment`, `FactLevel`,
    `FactDisplay`, `FactPolicy`, `FactLabelFn`, `FactLabels`.
  - When a date is rejected, the `reason` names what is wrong with it: more than
    three fractional-second digits (database timestamps), a space instead of
    `T` (git and Postgres text), no timezone, no seconds, an offset without a
    colon, a month-only or year-only value, lowercase `t` or `z`, surrounding
    whitespace, an impossible calendar date or an out-of-range time. The
    grammar itself is unchanged and stays strict.
  - Existing exports are unchanged.

### Fixed

- The default aging and stale messages say "1 day ago" instead of "1 days ago".
  Every other count is unchanged, and custom message functions still receive
  the plain number.
- A `Date` created in another realm (a `vm` context or an iframe) is accepted as
  the `now` clock when its time is valid. It was rejected because the check was
  `instanceof Date`. The check is now a brand check: the value must carry the
  internal Date slot, so an object that only sets `Symbol.toStringTag`, a Proxy
  around a Date, a number, a string and a duck-typed `{ getTime() }` object are
  still rejected with `RangeError`.

### Changed (behavior)

- `checkDatasetFreshness` picks `oldest` by exact review time when two records
  have the same whole-day age. Before, the first of them in input order won, even
  if a later record was hours older. Records with identical review times still
  keep input order. `dataset.level` and every `ageDays` are unchanged, because
  equal ages always share a level.

### Documented

- README: a check date means the day someone confirmed the fact, not a post,
  release or commit date; recipes for turning database timestamps, git dates,
  month-only values and nullable columns into accepted input; and a list of
  what `assessFact` does not do (no "expires soon" state, no "ended, date
  unknown" state, bare-date `expiresAt` is UTC midnight, no clock-skew grace
  for timestamps, neutral `label` wording, `boundary` is set per fact, nulls
  versus `undefined`). Behavior is unchanged.
- The README opening says who the library is for and what it does not do.
- "Stale after N days" means more than N whole days have passed. Age is floored,
  so a record 45 days and 23 hours old is still `aging` with
  `staleAfterDays: 45`. Behavior is unchanged.
- Dataset rows: the computed `result` always wins over a caller field of the
  same name. A caller field named `level` is kept as the caller's own extra and
  is not the verdict; use `row.result.level`. Behavior is unchanged.
- The `now` argument may be a real `Date` from any realm.

## [0.2.1] - 2026-10-07

No change to the library's behavior or API.

### Changed

- The README links to the [in-browser playground](https://lkopietz3-byte.github.io/honesty-kits/#freshness-kit) and the honesty kits family, and the npm homepage now points to the playground.
- Added the `honesty-kits` npm keyword so the family shows up together in search.

### Security

- Development lockfile: `source-map-js` 1.2.2 (GHSA-68fv-2mgg-jv7q). Development tooling only; the published package has no runtime dependencies.

## [0.2.0] - 2026-09-29

Minor release: some inputs that used to be accepted now throw, and the badge
wording is different. The exports and result shapes are unchanged.

### Fixed (breaking)

- **A sparse `records` array is rejected instead of skipped (FK-001).**
  `checkDatasetFreshness` validated with `.map`, which skips holes, then rolled
  up with `for...of`, which visits them. A hole-only array such as `new Array(1)`
  came back as `level: 'fresh'`, a hole after a real record crashed with a
  `TypeError`, and `new Array(2 ** 32 - 1)` made the call scan four billion
  slots. Every slot is now checked in one indexed pass: a hole, `undefined`,
  `null` or any non-object throws `RangeError` naming the index, and an
  inherited `Array.prototype` entry cannot fill a hole. `[]` still returns
  `level: 'fresh'` with `oldest: undefined`.
- **Inputs are read once.** `config`, `messages` and `now` are read once per
  call and each dataset entry is copied once (own enumerable fields, plus `id`
  and `reviewedOn` read explicitly, so class getters and inherited fields keep
  working and come back as plain fields), so a getter, a Proxy, a Date
  subclass or a message callback that changes the caller's objects cannot make
  the result differ from what was validated. Every record is classified before
  any message callback runs, so a rejected dataset runs no callbacks. A
  Date-shaped Proxy now gives `RangeError`, not a leaked `TypeError`.
- **`messages` must be `undefined` or a plain object.** A Map, class instance
  or `null` used to be read as "no overrides" and silently replaced by the
  default copy; it now throws `RangeError`. Only own `fresh`/`aging`/`stale`
  entries count, so a polluted `Object.prototype` cannot inject copy.
- **A message function must return a string.** A non-function entry or a
  non-string return value throws `TypeError` instead of flowing into
  `result.message`.

### Changed (breaking)

- **Badge wording says "reviewed", not "updated" (FK-003).**
  `freshnessBadgeText` returns `Reviewed 20d ago` for aging and
  `Stale — last reviewed 62d ago` for stale (was `Updated 20d ago` and
  `Stale — last updated 62d ago`). Fresh is still `''`. The input is a review
  date, and a review can confirm content that never changed.

### Documentation

- README: ESM/CommonJS compatibility table and Node support policy, pinned
  clocks in every dated example, the input-reading and callback contract, and
  the badge trust boundary. The stale "unparsable date is treated as zero days
  old" sentence is gone (it contradicted the strict parser), and the mislabeled
  `Modules` heading is now `Honest limits`.
- README (FK-004): the comparison with `claims-registry-kit` said it allows a
  flat 24 hours of future slack for both date forms. It uses 14 hours for a
  bare date and none for a timestamp, the same rule as this library, and
  differs past that line (it reports `'stale'`; this library throws). Checked
  against `claims-registry-kit` 0.3.0.
- ENGINEERING and PROJECT_CONTEXT: the package is published on npm; release
  workflow and runtime-support notes match the workflow; the purpose line says
  the kit does not verify the data.

### Internal

- The dataset roll-up compares `ageDays` only. With one shared config the level
  never decreases as age grows, so this picks the same record as before; the
  first of equally old records is `oldest`.
- `release.yml` now runs `audit:dependencies`, `verify` and `attw`, requires a
  `v*` tag ref on both triggers, and treats only a confirmed `E404` as "not
  published". `verify.yml` adds compatibility jobs on Node 20.19.0 and 22.12.0.

## [0.1.1] - 2026-09-27

### Added

- CommonJS `require()` support: a `"default"` condition next to `"import"`
  in the `exports` entry, pointing at the same built file. Proven against
  the packed tarball with `require()` on Node 26.3.0, and guarded in CI on
  Node 20, 22, and 24 by an extended `scripts/verify-package.mjs`.

### Fixed

- The shipped `.js.map` file now inlines the original TypeScript source
  (`inlineSources` in `tsconfig.build.json`), so it resolves without the
  unshipped `src/` directory. `.d.ts.map` generation is now disabled instead
  of shipping a source map with an unresolvable `../src/*.ts` path; the
  `.d.ts` declaration file itself is unaffected.

### Changed

- README: replaced "ESM only" with an accurate statement that `require()`
  also works on Node versions that support `require(esm)`.

## [0.1.0] - 2026-09-27

First release.

### Added

- `FreshnessLevel`, `FreshnessConfig`, `FreshnessResult`, `FreshnessMessageFn`,
  `FreshnessMessages`, `FreshnessRecord`, `EvaluatedFreshnessRecord`, and
  `DatasetFreshnessResult` types.
- `ageInDays` and `assessFreshness` for turning a `reviewedOn` date and a
  pair of thresholds into a whole-day age and a `'fresh' | 'aging' | 'stale'`
  level, with caller-overridable reader-facing messages.
- `checkDatasetFreshness` for rolling many records, each with its own
  `reviewedOn`, up to a single worst-case level while still returning every
  per-record result.
- `freshnessBadgeText` for rendering a `FreshnessResult` as a short,
  framework-agnostic badge string.
- Strict input validation throughout: `reviewedOn` must be a real
  `YYYY-MM-DD` calendar date or an ISO timestamp with seconds and an
  explicit timezone; thresholds must be non-negative safe integers with
  `warnAfterDays <= staleAfterDays`; `now` must be a genuine `Date` with a
  finite time; `records` must be an array of objects. Malformed, impossible,
  wrong-typed, or future review dates throw `RangeError` instead of being
  silently treated as age zero or a fresh result.
- A bare `YYYY-MM-DD` date carries no time zone, so it is accepted (and
  reads as age zero) as long as it is not later than today in every civil
  time zone: its UTC midnight may be up to 14 hours ahead of `now`. A
  timestamp with an explicit offset is an exact instant and has no such
  allowance: it throws if it is even one millisecond after `now`.
- Zero runtime dependencies. ESM only.
