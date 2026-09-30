# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
  time zone — its UTC midnight may be up to 14 hours ahead of `now`. A
  timestamp with an explicit offset is an exact instant and has no such
  allowance: it throws if it is even one millisecond after `now`.
- Zero runtime dependencies. ESM only.
