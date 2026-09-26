# Freshness Kit

A small TypeScript library that converts a caller-supplied review date and age thresholds into `fresh`, `aging`, or `stale` indicators. It helps a product show how long ago information was reviewed; it does not determine whether that information is still true.

## Start here

```sh
npm install
npm test
npm run typecheck
npm run build
```

The package has no runtime dependencies, is ESM, and is MIT licensed.

## Assess one item

```ts
import { assessFreshness, type FreshnessConfig } from "freshness-kit";

const config: FreshnessConfig = {
  warnAfterDays: 14,
  staleAfterDays: 45,
};

const result = assessFreshness("2026-06-01", config);

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

Use the rolled-up result for a page banner or a build check, and the per-record results to label individual rows.

## Render a short label

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

- `src/freshness.ts` — `ageInDays` and `assessFreshness`
- `src/dataset.ts` — `checkDatasetFreshness`
- `src/badge.ts` — `freshnessBadgeText`
- `src/types.ts` — freshness levels, configuration, messages, and result types
- `test/freshness.test.ts` — boundary, message, and dataset cases

## Limits

- The library calculates age from the `reviewedOn` value supplied by the caller. It cannot verify the underlying facts.
- A recent date is only as trustworthy as the review process that recorded it. Bumping the date without checking the information can make stale content look fresh.
- It does not store data, run scheduled reviews, send notifications, or check sources.
- An unparsable date is treated as zero days old by the current implementation. Validate dates at your input boundary if malformed values are possible.
- It supports two thresholds and the `fresh` → `aging` → `stale` progression. Use `ageInDays` directly if your policy needs different tiers.

