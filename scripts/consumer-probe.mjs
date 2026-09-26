// Imports the package by its published name from an installed tarball (not
// a relative path into src/ or dist/) and exercises the real API the way a
// consumer would, asserting real outputs rather than just "it exports
// something."
import assert from 'node:assert/strict';
import {
  ageInDays,
  assessFreshness,
  checkDatasetFreshness,
  freshnessBadgeText,
} from 'freshness-kit';

const NOW = new Date('2026-08-02T12:00:00Z');
const CONFIG = { warnAfterDays: 14, staleAfterDays: 45 };

// ageInDays: a real number, floored, computed against an injected clock.
assert.equal(ageInDays('2026-06-01', NOW), 62);

// assessFreshness: full result shape, with the default message text.
const stale = assessFreshness('2026-06-01', CONFIG, undefined, NOW);
assert.equal(stale.level, 'stale');
assert.equal(stale.ageDays, 62);
assert.equal(stale.reviewedOn, '2026-06-01');
assert.match(stale.message, /62 days ago/);

const fresh = assessFreshness('2026-07-25', CONFIG, undefined, NOW);
assert.equal(fresh.level, 'fresh');
assert.equal(fresh.message, '');

// A caller-supplied message override replaces only the level it names.
const overridden = assessFreshness('2026-06-01', CONFIG, {
  stale: (ageDays) => `CUSTOM ${ageDays}`,
}, NOW);
assert.equal(overridden.message, 'CUSTOM 62');

// The documented input contract: invalid input throws RangeError, never a
// silent fresh result or a bare TypeError from a wrong runtime type.
assert.throws(() => ageInDays('not-a-date', NOW), RangeError);
assert.throws(() => ageInDays('2026-08-10', NOW), RangeError); // future
assert.throws(() => ageInDays(['2026-06-01'], NOW), RangeError); // wrong type

// checkDatasetFreshness: worst-level roll-up plus every per-record result.
const dataset = checkDatasetFreshness(
  [
    { id: 'a', reviewedOn: '2026-07-30' }, // fresh
    { id: 'b', reviewedOn: '2026-06-01' }, // stale, and the oldest
  ],
  CONFIG,
  undefined,
  NOW,
);
assert.equal(dataset.level, 'stale');
assert.equal(dataset.oldest?.id, 'b');
assert.deepEqual(dataset.records.map((r) => r.result.level), ['fresh', 'stale']);

const emptyDataset = checkDatasetFreshness([], CONFIG, undefined, NOW);
assert.equal(emptyDataset.level, 'fresh');
assert.equal(emptyDataset.oldest, undefined);

// freshnessBadgeText: short text derived from a real result.
assert.equal(freshnessBadgeText(fresh), '');
assert.equal(freshnessBadgeText(stale), 'Stale — last updated 62d ago');

console.log('freshness-kit consumer probe: all assertions passed');
