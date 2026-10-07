import type { QueryEvaluationTime } from '../domain/publication-filter';

/** Application boundary: capture once for Apply/Refresh, consulting the current
 * system zone each time. UI locale and synthetic display clocks do not govern queries. */
export function systemQueryEvaluationTime(): QueryEvaluationTime {
  return { now: Date.now(), timeZone: new Intl.DateTimeFormat().resolvedOptions().timeZone };
}
