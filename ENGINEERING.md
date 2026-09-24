# Engineering contract

This package is a pure TypeScript/ESM date classifier. It has no UI, storage,
network, scheduling, or content-verification capability. The source entry
is `src/index.ts`; the package export resolves to generated `dist/index.js`.

## Invariants and critical paths

- `ageInDays` parses unambiguous real dates and rejects future instants and
  invalid clocks before arithmetic; it never converts bad dates to zero.
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

The stricter input contract is behavior-breaking for callers relying on old
permissive parsing. Before publishing, choose the appropriate new version,
audit actual consumers, test a packed artifact in a clean consumer on the
declared supported Node versions, and verify the host's visible unavailable
path. No runtime support matrix or clean CI gate is certified by local tests.
No publication or deployment is authorized by this contract.

Keep the previous source revision and generated distribution identifiable.
If reverting a release, validate inputs in the host first: reverting to the
original parser restores its silent-fresh defect. A source patch alone does
not update an installed consumer or deployed package.
