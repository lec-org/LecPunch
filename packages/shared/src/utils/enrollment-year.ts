/** Plausibility only: a year never becomes an admitted cohort merely because time passes. */
export function isValidEnrollmentYear(value: unknown, referenceYear = Number(new Intl.DateTimeFormat('en', {
  timeZone: 'Asia/Shanghai', year: 'numeric'
}).format(new Date()))): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 2000 && value <= referenceYear + 1;
}
