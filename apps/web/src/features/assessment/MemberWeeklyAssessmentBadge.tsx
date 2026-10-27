import { weeklyGoalSeconds, type TeamWeeklyStatItem } from '@lecpunch/shared';
import { CircleCheck, Circle } from 'lucide-react';

export const MemberWeeklyAssessmentBadge = ({ member }: { member: TeamWeeklyStatItem }) => {
  const goal = member.weeklyGoalSeconds ?? (Number.isInteger(member.enrollYear) ? weeklyGoalSeconds(member.enrollYear) : NaN);
  const complete = Number.isFinite(goal) && Number.isFinite(member.totalDurationSeconds)
    ? member.totalDurationSeconds >= goal : null;
  return <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium ${complete ? 'bg-green-50 text-green-800' : 'bg-gray-100 text-gray-600'}`}>
    {complete ? <CircleCheck size={14} aria-hidden="true" /> : <Circle size={14} aria-hidden="true" />}
    {complete === null ? '本周待核实' : complete ? '本周已完成' : '本周未完成'}
  </span>;
};
