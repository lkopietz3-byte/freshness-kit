export type {
  FreshnessLevel,
  FreshnessConfig,
  FreshnessResult,
  FreshnessMessageFn,
  FreshnessMessages,
  FreshnessRecord,
  EvaluatedFreshnessRecord,
  DatasetFreshnessResult,
  FactLevel,
  FactDisplay,
  FactPolicy,
  DatedFact,
  FactAssessment,
  FactLabelFn,
  FactLabels,
  FactsAssessment,
} from './types.js'

export { ageInDays, assessFreshness } from './freshness.js'
export { checkDatasetFreshness } from './dataset.js'
export { freshnessBadgeText } from './badge.js'
export { assessFact, assessFacts } from './assess-fact.js'
