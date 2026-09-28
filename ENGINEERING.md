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

## Are the types wrong? (attw)

CI runs [`arethetypeswrong`](https://github.com/arethetypeswrong/arethetypeswrong.github.io)
(`npm run attw`, which is `attw --pack . --ignore-rules cjs-resolves-to-esm`)
against the packed tarball after the build step. The `cjs-resolves-to-esm` rule is ignored on
purpose: this is an ESM-only package (`"type": "module"`, no `require` entry point), so a
CommonJS consumer must use Node's `require(esm)` support (Node >=20.19 or >=22.12 — see
"Runtime support policy" below) rather than a native `require`. A dual CJS+ESM build was
rejected to avoid the dual-package hazard (two separately-identified copies of the same module,
with broken `instanceof` checks and duplicated module state across the CJS and ESM entry
points).

## Release and rollback

`npm run verify` (lint, typecheck, test, build, verify:package) runs automatically before
publish via the `prepublishOnly` script, so a broken build cannot reach the registry by
accident. To release: add a dated entry to `CHANGELOG.md`, bump `version` in
`package.json`, commit, and push a `vX.Y.Z` tag that matches the new version, then let
`.github/workflows/release.yml` install, verify, and publish it. (You can also run
`npm publish` locally; `prepublishOnly` still guards it.)

npm's unpublish policy is deliberately narrow. Within 72 hours of publishing, a version can be
unpublished only if no other published package depends on it. After 72 hours, unpublishing also
requires fewer than 300 downloads in the last week and a single maintainer — most released
versions won't qualify either way. A given `name@version` can never be reused, published or
not, even after an unpublish. Treat unpublish as unavailable: prefer fixing forward with a new
patch version, and use `npm deprecate <name>@"<range>" "<message>"` to warn consumers off a
bad release while it stays installable for anyone already pinned to it.

If a future change ever reverts the strict input-validation behavior, note that the
original permissive parser silently treated invalid input as fresh — that defect returns
with it.

### Runtime support policy

- **Supported (recommended for production):** Node 22 and 24 LTS; Node 26 current.
- **Compatibility-tested:** Node 20. Node 20 is end-of-life — nodejs.org's release page
  (<https://nodejs.org/en/about/previous-releases>) lists it as `EOL`, with its final release
  dated Mar 24, 2026. The `compat` job in `verify.yml` still runs on Node 20 to catch
  regressions, but that runtime gets no security fixes upstream; don't run production traffic
  on it.
- CommonJS `require()` of this package needs Node >=20.19 or >=22.12 (`require(esm)`
  support). ESM `import` works on every version this package tests (20, 22, 24).
- `engines` in `package.json` is unchanged by this policy.

### Publishing with provenance

`.github/workflows/release.yml` publishes using npm trusted publishing: it triggers on
`workflow_dispatch` or a pushed `v*` tag, requests a short-lived OIDC token instead of
reading a stored npm token (`permissions: id-token: write`), and runs a plain `npm publish`
with no token and no `--provenance` flag, because provenance attestation is generated
automatically under trusted publishing. Before publishing, the workflow confirms the tag
matches `package.json`'s `version` and checks whether that version is already on the
registry, so re-running it on a version that's already published is a no-op rather than an
error. Trusted publishing must be configured for this package on npmjs.com (linking it to this
GitHub repository and the `release.yml` workflow) before the first automated release will
work.
