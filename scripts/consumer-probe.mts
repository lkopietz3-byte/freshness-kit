// Strict NodeNext type probe: compiled (never run) by scripts/verify-package.mjs
// against the installed .d.ts files, the way a TypeScript consumer's own
// tsconfig (strict, NodeNext) would see this package. No @types/node here
// (this kit has none as a dev dependency), so no `node:` imports — a tiny
// local assert stands in.
import {
  ageInDays,
  assessFreshness,
  checkDatasetFreshness,
  freshnessBadgeText,
  type DatasetFreshnessResult,
  type EvaluatedFreshnessRecord,
  type FreshnessConfig,
  type FreshnessLevel,
  type FreshnessMessages,
  type FreshnessRecord,
  type FreshnessResult,
} from 'freshness-kit';

function assertEqual<T>(actual: T, expected: T, message: string): void {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${String(expected)}, got ${String(actual)}`);
  }
}

const now = new Date('2026-08-02T12:00:00Z');
const config: FreshnessConfig = { warnAfterDays: 14, staleAfterDays: 45 };

const age: number = ageInDays('2026-06-01', now);
assertEqual(age, 62, 'ageInDays');

const messages: FreshnessMessages = {
  stale: (ageDays, reviewedOn) => `CUSTOM ${ageDays} ${reviewedOn}`,
};
const result: FreshnessResult = assessFreshness('2026-06-01', config, messages, now);
const level: FreshnessLevel = result.level;
assertEqual(level, 'stale', 'assessFreshness level');
assertEqual(result.message, 'CUSTOM 62 2026-06-01', 'assessFreshness message override');

const badge: string = freshnessBadgeText(result);
assertEqual(badge, 'Stale — last updated 62d ago', 'freshnessBadgeText');

const records: FreshnessRecord[] = [
  { id: 'a', reviewedOn: '2026-07-30' },
  { id: 'b', reviewedOn: '2026-06-01' },
];
const dataset: DatasetFreshnessResult = checkDatasetFreshness(records, config, undefined, now);
const oldest: EvaluatedFreshnessRecord | undefined = dataset.oldest;
assertEqual(dataset.level, 'stale', 'dataset level');
assertEqual(oldest?.id, 'b', 'dataset oldest id');
assertEqual(dataset.records.length, 2, 'dataset records length');

console.log('consumer-probe.mts: type probe assembled without error');
