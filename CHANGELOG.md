# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
