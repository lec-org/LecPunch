import { DateTime } from 'luxon';
import { assessmentEnrollYears, requiresWeeklyAssessment } from '@lecpunch/shared';

const ZONE = 'Asia/Shanghai';
const OBSERVATION_GAP_MS = 5 * 60_000;
const SETTLEMENT_DELAY_MS = 5 * 3_600_000;

export interface AssessmentMemberSnapshot {
  userId: string;
  enrollYear?: number | null;
  goalSeconds: number | null;
  createdAt: number | null;
  /** Use only a reliable admission timestamp; account creation is not proof of SSO admission. */
  joinedAt?: number | null;
  status: 'active' | 'disabled' | 'unknown';
}
export type AssessmentReason = 'eligible' | 'new_member' | 'disabled' | 'before_enabled' |
  'not_observed_at_start' | 'not_observed_continuously' | 'invalid_member_data' | 'outside_cohort';
export interface AssessmentRosterEntry {
  enrollYearSnapshot?: number | null;
  goalSeconds: number | null;
  eligible: boolean;
  reason: AssessmentReason;
  createdAtSnapshot: number | null;
  joinedAtSnapshot: number | null;
}
export interface AssessmentTotals {
  rawSeconds: number;
  manualSeconds: number;
  entertainmentSeconds: number;
}
export interface AssessmentOutcome {
  userId: string;
  status: 'complete' | 'failed' | 'exempt' | 'pending';
  reason: string;
  goalSeconds: number | null;
  rawSeconds: number | null;
  manualSeconds: number | null;
  entertainmentSeconds: number | null;
  comprehensiveSeconds: number | null;
  settledAt: number | null;
}
export interface AssessmentWeekState {
  version: 1;
  requiredEnrollYears?: number[];
  weekKey: string;
  startsAt: number;
  endsAt: number;
  enabledAt: number;
  firstObservedAt: number;
  lastObservedAt: number;
  coverageTrusted: boolean;
  roster: Record<string, AssessmentRosterEntry>;
  outcomes: Record<string, AssessmentOutcome>;
}

function validTimestamp(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}
function validSeconds(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value);
}
function weekBounds(weekKey: string) {
  const monday = DateTime.fromFormat(weekKey, 'yyyy-MM-dd', {zone: ZONE}).startOf('day');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(weekKey) || !monday.isValid || monday.weekday !== 1 || monday.toFormat('yyyy-MM-dd') !== weekKey) {
    throw new Error('考核周必须是北京时间周一的 yyyy-MM-dd 日期');
  }
  return {startsAt: monday.toMillis(), endsAt: monday.plus({days: 7}).toMillis()};
}
function assertMembers(members: AssessmentMemberSnapshot[]) {
  const ids = new Set<string>();
  for (const member of members) {
    if (!member.userId || ids.has(member.userId) || ['__proto__', 'prototype', 'constructor'].includes(member.userId)) {
      throw new Error('成员稳定标识无效或重复');
    }
    ids.add(member.userId);
  }
}
function rosterEntry(member: AssessmentMemberSnapshot, state: Pick<AssessmentWeekState, 'startsAt' | 'enabledAt' | 'requiredEnrollYears'>,
  atStart: boolean): AssessmentRosterEntry {
  const goal = validSeconds(member.goalSeconds) && member.goalSeconds > 0 ? member.goalSeconds : null;
  const created = validTimestamp(member.createdAt) ? member.createdAt : null;
  const joined = validTimestamp(member.joinedAt) ? member.joinedAt : null;
  let reason: AssessmentReason = 'eligible';
  if (state.startsAt < state.enabledAt) reason = 'before_enabled';
  else if (Number.isInteger(member.enrollYear) && !requiresWeeklyAssessment(member.enrollYear!, state.requiredEnrollYears ?? [])) reason = 'outside_cohort';
  else if (member.status === 'disabled') reason = 'disabled';
  else if ((created !== null && created >= state.startsAt) || (joined !== null && joined >= state.startsAt)) reason = 'new_member';
  else if (!atStart) reason = 'not_observed_at_start';
  // A reliable joinedAt is required; old account creation alone cannot establish admission.
  else if (!Number.isInteger(member.enrollYear) || goal === null || created === null || joined === null || member.status !== 'active') reason = 'invalid_member_data';
  return {enrollYearSnapshot: Number.isInteger(member.enrollYear) ? member.enrollYear : null, goalSeconds: goal, eligible: reason === 'eligible', reason,
    createdAtSnapshot: created, joinedAtSnapshot: joined};
}

/** No historical week is manufactured when observation starts after its end. */
export function createAssessmentWeek(weekKey: string, observedAt: number, members: AssessmentMemberSnapshot[],
  enabledAt: number, previousRequiredEnrollYears: number[] = []): AssessmentWeekState {
  const bounds = weekBounds(weekKey);
  if (!validTimestamp(observedAt) || !validTimestamp(enabledAt) || observedAt < bounds.startsAt || observedAt >= bounds.endsAt) {
    throw new Error('只能在该周内建立真实观测快照');
  }
  assertMembers(members);
  const state: AssessmentWeekState = {version: 1, weekKey, ...bounds, enabledAt,
    requiredEnrollYears: assessmentEnrollYears(members.map(member => member.enrollYear), previousRequiredEnrollYears),
    firstObservedAt: observedAt, lastObservedAt: observedAt,
    coverageTrusted: observedAt <= bounds.startsAt + OBSERVATION_GAP_MS,
    roster: {}, outcomes: {}};
  for (const member of members) state.roster[member.userId] = rosterEntry(member, state, state.coverageTrusted);
  return state;
}

/** Each observation is a complete team roster, never a partial page or active-only query. */
export function observeAssessmentWeek(state: AssessmentWeekState, observedAt: number,
  members: AssessmentMemberSnapshot[], previousRequiredEnrollYears: number[] = []): AssessmentWeekState {
  if (!validTimestamp(observedAt) || observedAt < state.lastObservedAt) throw new Error('考核观测时间不能倒退');
  assertMembers(members);
  const next = structuredClone(state);
  const coverageUntil = Math.min(observedAt, next.endsAt);
  if (coverageUntil - next.lastObservedAt > OBSERVATION_GAP_MS) next.coverageTrusted = false;
  next.lastObservedAt = Math.max(next.lastObservedAt, coverageUntil);
  // Changes seen only after the boundary do not alter eligibility in the closed week.
  if (observedAt >= next.endsAt) return next;
  next.requiredEnrollYears = assessmentEnrollYears(members.map(member => member.enrollYear), [...(next.requiredEnrollYears ?? []), ...previousRequiredEnrollYears]);
  const observed = new Map(members.map(member => [member.userId, member]));
  for (const [userId, entry] of Object.entries(next.roster)) {
    if (next.outcomes[userId] && next.outcomes[userId].status !== 'pending') continue;
    const member = observed.get(userId);
    // Enrich an old, still-open roster only from an actual observation; never infer historical cohort data.
    if (entry.enrollYearSnapshot === undefined && member) {
      entry.enrollYearSnapshot = typeof member.enrollYear === 'number' && Number.isInteger(member.enrollYear) ? member.enrollYear : null;
      if (entry.enrollYearSnapshot === null) { entry.eligible = false; entry.reason = 'invalid_member_data'; }
    }
    if (typeof entry.enrollYearSnapshot === 'number' && !requiresWeeklyAssessment(entry.enrollYearSnapshot, next.requiredEnrollYears)) { entry.eligible = false; entry.reason = 'outside_cohort'; }
    if (entry.reason === 'outside_cohort') continue;
    if (member?.status === 'disabled') { entry.eligible = false; entry.reason = 'disabled'; }
    else if (!member && entry.eligible) { entry.eligible = false; entry.reason = 'not_observed_continuously'; }
    else if (member?.status === 'unknown' && entry.eligible) { entry.eligible = false; entry.reason = 'invalid_member_data'; }
    // Goal and creation/admission snapshots intentionally remain immutable.
  }
  for (const member of members) if (!Object.prototype.hasOwnProperty.call(next.roster, member.userId)) {
    next.roster[member.userId] = rosterEntry(member, next, false);
  }
  return next;
}

function comprehensive(totals: AssessmentTotals | undefined): number | null {
  if (!totals || !validSeconds(totals.rawSeconds) || totals.rawSeconds < 0 ||
    !validSeconds(totals.manualSeconds) || !validSeconds(totals.entertainmentSeconds)) return null;
  const adjusted = totals.rawSeconds + totals.manualSeconds;
  if (!Number.isSafeInteger(adjusted)) return null;
  const sum = Math.max(0, adjusted) + totals.entertainmentSeconds;
  return Number.isSafeInteger(sum) ? sum : null;
}

/** Complete/failed/exempt outcomes are immutable. Pending evidence may later become available. */
export function finalizeAssessmentWeek(state: AssessmentWeekState, now: number,
  totals: Record<string, AssessmentTotals | undefined>): AssessmentWeekState {
  if (!validTimestamp(now)) throw new Error('结算时间无效');
  const next = structuredClone(state);
  for (const [userId, entry] of Object.entries(next.roster)) {
    if (next.outcomes[userId] && next.outcomes[userId].status !== 'pending') continue;
    const result: AssessmentOutcome = {userId, status: 'pending', reason: 'settlement_window', goalSeconds: entry.goalSeconds,
      rawSeconds: null, manualSeconds: null, entertainmentSeconds: null, comprehensiveSeconds: null, settledAt: null};
    if (now < next.endsAt + SETTLEMENT_DELAY_MS) { next.outcomes[userId] = result; continue; }
    if (['new_member', 'disabled', 'before_enabled', 'outside_cohort'].includes(entry.reason)) {
      result.status = 'exempt'; result.reason = entry.reason; result.settledAt = now;
    } else if (!entry.eligible) result.reason = entry.reason;
    else if (!Number.isInteger(entry.enrollYearSnapshot)) result.reason = 'invalid_member_data';
    else if (!next.coverageTrusted || next.lastObservedAt < next.endsAt - OBSERVATION_GAP_MS) result.reason = 'incomplete_observation';
    else {
      const data = totals[userId];
      const total = comprehensive(data);
      if (total === null || !validSeconds(entry.goalSeconds) || entry.goalSeconds <= 0) result.reason = 'invalid_totals';
      else {
        result.status = total >= entry.goalSeconds ? 'complete' : 'failed'; result.reason = 'settled';
        result.rawSeconds = data!.rawSeconds; result.manualSeconds = data!.manualSeconds;
        result.entertainmentSeconds = data!.entertainmentSeconds; result.comprehensiveSeconds = total; result.settledAt = now;
      }
    }
    next.outcomes[userId] = result;
  }
  return next;
}
