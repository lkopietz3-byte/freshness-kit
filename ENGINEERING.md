# Engineering contract

This package is a pure TypeScript/ESM date classifier. It has no UI, storage,
network, scheduling, or content-verification capability. The source entry
is `src/index.ts`; the package export resolves to generated `dist/index.js`.

## Invariants and critical paths

- `ageInDays` parses unambiguous real dates and rejects future instants and
  invalid clocks before arithmetic; it never converts bad dates to zero.
- Future-date tolerance is asymmetric by design: a bare `YYYY-MM-DD` date has
  no zone, so it is accepted up to 14 hours ahead of `now` (UTC+14 is the
  furthest-ahead civil offset) and floors to age 0; an explicit-offset
  timestamp is an exact instant with zero tolerance. Do not unify these
  without re-deriving the 14-hour constant from the IANA database.
- Every entry point rejects the wrong runtime type instead of coercing or
  crashing: non-string `reviewedOn`, non-object `config`, non-`Date` `now`,
  non-array `records`, and non-object dataset entries all throw `RangeError`,
  never `TypeError` and never a silent accept (see test/wrong-types.test.ts).
- `assessFreshness` validates thresholds before classifying. Valid results
  retain fresh/aging/stale and inclusive boundary behavior.
- `checkDatasetFreshness` aborts if any record is invalid. An empty dataset
  validates context but proves no completeness. Badge composition cannot
  hide an error from either assessment API.
- Callers render input failures visibly or fail CI. Do not synthesize fresh
  results after errors. This package does not prove source accuracy.

## Setup and verification

Declared dependencies are TypeScript and Vitest in package-lock.json.
For a clean environment use `npm ci`. During local work, reuse a compatible
installed dependency tree when safe. Run sequentially:

```sh
npm test -- --no-file-parallelism --maxWorkers=1 --no-cache
npm run typecheck
npm run build
node --input-type=module -e 'import {assessFreshness} from "./dist/index.js"; console.log(assessFreshness("2026-07-01", {warnAfterDays:14,staleAfterDays:45}, undefined, new Date("2026-08-02T12:00:00Z")))'
```

Tests cover actual date classification and rejection paths, offsets,
calendar rollover, clocks, thresholds, dataset propagation, messages and
badges. The invalid-input regression must fail on the original source.

## Release and rollback

`npm run verify` (lint, typecheck, test, build, verify:package) runs
automatically before publish via the `prepublishOnly` script. This is the
first release, so there is no installed base yet; from the next release on,
treat any change to input-validation strictness as behavior-breaking, call
it out in `CHANGELOG.md`, and test the packed tarball in a clean consumer on
the declared supported Node versions first.

npm allows `npm unpublish` only within 72 hours of publishing, so prefer
publishing a fixed patch version over trying to unpublish a bad release. If
a future change ever reverts the strict input validation, note that the
original permissive parser silently treated invalid input as fresh — that
defect returns with it.
