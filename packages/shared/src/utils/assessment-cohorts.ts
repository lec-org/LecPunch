import { isValidEnrollmentYear } from './enrollment-year';
/** A real admitted cohort triggers advancement. Persisted evidence prevents rollback after member removal. */
export function assessmentEnrollYears(enrollYears: readonly (number | null | undefined)[], previous: readonly number[] = [], referenceYear?: number): number[] {
  const valid = [...enrollYears, ...previous].filter((year): year is number => isValidEnrollmentYear(year, referenceYear));
  if (!valid.length) return [];
  const latest = Math.max(...valid);
  return [latest, latest - 1];
}

export function requiresWeeklyAssessment(enrollYear: number, requiredYears: readonly number[]): boolean {
  return Number.isInteger(enrollYear) && requiredYears.includes(enrollYear);
}
