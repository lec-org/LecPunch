import { ServiceUnavailableException } from '@nestjs/common';
import { assessmentEnrollYears, isValidEnrollmentYear } from '@lecpunch/shared';
import type { Model } from 'mongoose';
import type { AssessmentWeekDocument } from './schemas/assessment.schema';

export function assertCohortYears(years: unknown[], week: string) {
  if (years.some(year => !isValidEnrollmentYear(year, Number(week.slice(0, 4))))) {
    throw new ServiceUnavailableException('Invalid enrollment year: correct member data before assessment; historical snapshots were not rewritten');
  }
}

/** Shared by assessment and card targeting; reads the same durable cohort high-water mark. */
export async function readAssessmentCohorts(weeks: Model<AssessmentWeekDocument>, teamId: string, years: Array<number | null | undefined>, week: string) {
  assertCohortYears(years, week);
  const maximum = Number(week.slice(0, 4)) + 1;
  const rows = await weeks.aggregate<{ latest: number; invalid?: number }>([
    { $match: { teamId, weekKey: { $lte: week } } }, { $unwind: '$state.requiredEnrollYears' },
    { $group: { _id: null, latest: { $max: '$state.requiredEnrollYears' }, invalid: { $sum: { $cond: [{ $and: [
      { $gte: ['$state.requiredEnrollYears', 2000] }, { $lte: ['$state.requiredEnrollYears', maximum] },
      { $eq: ['$state.requiredEnrollYears', { $trunc: '$state.requiredEnrollYears' }] }
    ] }, 0, 1] } } } }
  ]).exec();
  if (rows.some(row => row.invalid || !isValidEnrollmentYear(row.latest, maximum - 1))) {
    throw new ServiceUnavailableException('Invalid persisted cohort evidence: audited correction required; assessment remains pending');
  }
  return assessmentEnrollYears(years, rows.length ? [rows[0].latest] : [], maximum - 1);
}
