export type {
  FreshnessLevel,
  FreshnessConfig,
  FreshnessResult,
  FreshnessMessageFn,
  FreshnessMessages,
  FreshnessRecord,
  EvaluatedFreshnessRecord,
  DatasetFreshnessResult,
} from './types.js'

export { ageInDays, assessFreshness } from './freshness.js'
export { checkDatasetFreshness } from './dataset.js'
export { freshnessBadgeText } from './badge.js'
