/** Fail a test/harness clearly when a required application target is absent. */
export function required<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error('Missing required test target');
  return value;
}
