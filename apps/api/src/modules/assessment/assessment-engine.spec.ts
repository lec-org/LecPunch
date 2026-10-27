import {describe, expect, it} from 'vitest';
import { assessmentEnrollYears, requiresWeeklyAssessment } from '@lecpunch/shared';
import {createAssessmentWeek, finalizeAssessmentWeek, observeAssessmentWeek, AssessmentMemberSnapshot,
  AssessmentWeekState, AssessmentTotals} from './assessment-engine';

const start = Date.parse('2026-10-25T16:00:00.000Z'); // Monday 00:00 Asia/Shanghai
const end = start + 7 * 24 * 3600000;
const afterWindow = end + 5 * 3600000;
const oldMember = (userId='one'): AssessmentMemberSnapshot => ({userId, enrollYear:2025, goalSeconds:3600,
  createdAt:start-86400000,joinedAt:start-3600000,status:'active'});
const totals = (rawSeconds=3600,manualSeconds=0,entertainmentSeconds=0): AssessmentTotals => ({rawSeconds,manualSeconds,entertainmentSeconds});
function observedWeek(members=[oldMember()]): AssessmentWeekState {
  let state=createAssessmentWeek('2026-10-26',start,members,start);
  for(let at=start+300000;at<end;at+=300000) state=observeAssessmentWeek(state,at,members);
  return state;
}

describe('assessment snapshot boundaries',()=>{
  it('switches only when a new cohort exists, independent of dates, and retains advancement evidence', () => {
    expect(assessmentEnrollYears([2024, 2025])).toEqual([2025, 2024]);
    expect(assessmentEnrollYears([2024, 2025, 2026])).toEqual([2026, 2025]);
    expect(assessmentEnrollYears([2025], [2026, 2025])).toEqual([2026, 2025]);
    expect(assessmentEnrollYears([null, undefined, NaN])).toEqual([]);
    expect(requiresWeeklyAssessment(2027, [2026, 2025])).toBe(false);
    expect(requiresWeeklyAssessment(NaN, [2026, 2025])).toBe(false);
  });
  it('exempts older cohorts and advances the open week when an actual new member appears', () => {
    const members = [{ ...oldMember('senior'), enrollYear: 2024 }, { ...oldMember('freshman'), enrollYear: 2026 }, oldMember()];
    const state = observedWeek(members);
    const result = finalizeAssessmentWeek(state, afterWindow, { one: totals(0), freshman: totals(0) });
    expect(result.outcomes.senior).toMatchObject({ status: 'exempt', reason: 'outside_cohort' });
    expect(result.outcomes.one.status).toBe('failed'); expect(result.outcomes.freshman.status).toBe('failed');
    // Time passing, including September, does not change an already observed roster.
    expect(finalizeAssessmentWeek(state, Date.parse('2027-09-10'), { one: totals(0) }).outcomes.one.status).toBe('failed');
    const advanced = observeAssessmentWeek(state, end - 1, [...members, { ...oldMember('new'), enrollYear: 2027, joinedAt: start + 1 }]);
    expect(advanced.requiredEnrollYears).toEqual([2027, 2026]);
    expect(finalizeAssessmentWeek(advanced, afterWindow, {}).outcomes.one).toMatchObject({ status: 'exempt', reason: 'outside_cohort' });
    expect(finalizeAssessmentWeek(advanced, afterWindow, {}).outcomes.new).toMatchObject({ status: 'exempt', reason: 'new_member' });
    const nextStart = Date.parse('2027-09-05T16:00:00Z');
    const next = createAssessmentWeek('2027-09-06', nextStart, members, start);
    expect(next.requiredEnrollYears).toEqual([2026, 2025]);
    expect(next.roster.one.eligible).toBe(true);
    const preserved = createAssessmentWeek('2027-09-06', nextStart, [oldMember()], start, advanced.requiredEnrollYears);
    expect(preserved.requiredEnrollYears).toEqual([2027, 2026]);
    expect(preserved.roster.one.reason).toBe('outside_cohort');
  });
  it('enriches open legacy rosters from observation but does not guess a closed roster cohort', () => {
    const legacy = observedWeek(); delete legacy.roster.one.enrollYearSnapshot;
    expect(finalizeAssessmentWeek(legacy, afterWindow, { one: totals(0) }).outcomes.one).toMatchObject({ status: 'pending', reason: 'invalid_member_data' });
    const updated = observeAssessmentWeek(legacy, end - 1, [{ ...oldMember(), enrollYear: 2023 }]);
    expect(finalizeAssessmentWeek(updated, afterWindow, {}).outcomes.one).toMatchObject({ status: 'exempt', reason: 'outside_cohort' });
    expect(legacy.roster.one.enrollYearSnapshot).toBeUndefined();
  });
  it('applies inherited cohort evidence to an already-created open week without changing closed outcomes', () => {
    const state = observedWeek();
    const advanced = observeAssessmentWeek(state, end - 1, [oldMember()], [2027, 2026]);
    expect(advanced.requiredEnrollYears).toEqual([2027, 2026]);
    expect(finalizeAssessmentWeek(advanced, afterWindow, { one: totals(0) }).outcomes.one).toMatchObject({ status: 'exempt', reason: 'outside_cohort' });
    expect(state.requiredEnrollYears).toEqual([2025, 2024]);
    const closed = finalizeAssessmentWeek(state, afterWindow, { one: totals(0) });
    const late = observeAssessmentWeek(closed, afterWindow + 1, [], [2027, 2026]);
    expect(late.requiredEnrollYears).toEqual(closed.requiredEnrollYears);
    expect(late.outcomes).toEqual(closed.outcomes);
  });
  it('uses Shanghai Monday and refuses invalid/non-Monday/missing historical observation',()=>{
    const state=createAssessmentWeek('2026-10-26',start,[oldMember()],start);
    expect(state.startsAt).toBe(start);expect(state.endsAt).toBe(end);
    expect(()=>createAssessmentWeek('2026-10-27',start,[oldMember()],start)).toThrow('周一');
    expect(()=>createAssessmentWeek('2026-02-30',start,[oldMember()],start)).toThrow('周一');
    expect(()=>createAssessmentWeek('2026-10-26',end,[oldMember()],start)).toThrow('真实观测');
    expect(()=>createAssessmentWeek('2026-10-26',start-1,[oldMember()],start)).toThrow('真实观测');
  });
  it('requires reliable qualification evidence and never treats old account creation as admission',()=>{
    const member=oldMember();delete member.joinedAt;
    const state=observedWeek([member]);const result=finalizeAssessmentWeek(state,afterWindow,{one:totals(0)});
    expect(result.outcomes.one.status).toBe('pending');expect(result.outcomes.one.reason).toBe('invalid_member_data');
  });
  it('exempts accounts created/admitted during the week including exactly the boundary',()=>{
    const created=oldMember('created');created.createdAt=start;
    const joined=oldMember('joined');joined.joinedAt=start+100;
    const state=createAssessmentWeek('2026-10-26',start,[created,joined],start);
    const result=finalizeAssessmentWeek(state,afterWindow,{});
    expect(result.outcomes.created.status).toBe('exempt');expect(result.outcomes.joined.status).toBe('exempt');
    expect(result.outcomes.created.reason).toBe('new_member');
  });
  it('does not penalize weeks beginning before feature activation',()=>{
    const state=createAssessmentWeek('2026-10-26',start+1,[oldMember()],start+1);
    expect(finalizeAssessmentWeek(state,afterWindow,{}).outcomes.one).toMatchObject({status:'exempt',reason:'before_enabled'});
  });
  it('marks first observation late only after five minutes, irreversibly',()=>{
    expect(createAssessmentWeek('2026-10-26',start+300000,[oldMember()],start).coverageTrusted).toBe(true);
    const late=createAssessmentWeek('2026-10-26',start+300001,[oldMember()],start);
    expect(late.coverageTrusted).toBe(false);
    expect(finalizeAssessmentWeek(late,afterWindow,{one:totals(0)}).outcomes.one.status).toBe('pending');
  });
  it('observation gaps exceeding five minutes cannot be hidden by later polling',()=>{
    const initial=createAssessmentWeek('2026-10-26',start,[oldMember()],start);
    expect(observeAssessmentWeek(initial,start+300000,[oldMember()]).coverageTrusted).toBe(true);
    const gap=observeAssessmentWeek(initial,start+300001,[oldMember()]);
    const later=observeAssessmentWeek(gap,start+300002,[oldMember()]);expect(later.coverageTrusted).toBe(false);
    expect(initial.lastObservedAt).toBe(start);expect(initial.coverageTrusted).toBe(true);
    expect(()=>observeAssessmentWeek(later,start,[oldMember()])).toThrow('不能倒退');
  });
  it('observed disabled membership stays exempt after reactivation, while removal remains pending',()=>{
    let state=createAssessmentWeek('2026-10-26',start,[oldMember(),oldMember('gone')],start);
    const disabled={...oldMember(),status:'disabled' as const};
    state=observeAssessmentWeek(state,start+1,[disabled]);
    state=observeAssessmentWeek(state,start+2,[oldMember(),oldMember('gone')]);
    const result=finalizeAssessmentWeek(state,afterWindow,{one:totals(0),gone:totals(0)});
    expect(result.outcomes.one).toMatchObject({status:'exempt',reason:'disabled'});
    expect(result.outcomes.gone).toMatchObject({status:'pending',reason:'not_observed_continuously'});
  });
  it('an old member first appearing mid-week has incomplete qualification, new member is exempt',()=>{
    let state=createAssessmentWeek('2026-10-26',start,[],start);
    const added=oldMember('new');added.createdAt=start+1;added.joinedAt=start+1;
    state=observeAssessmentWeek(state,start+2,[oldMember(),added]);
    const result=finalizeAssessmentWeek(state,afterWindow,{one:totals(0)});
    expect(result.outcomes.one).toMatchObject({status:'pending',reason:'not_observed_at_start'});
    expect(result.outcomes.new.status).toBe('exempt');
  });
  it('keeps initial goal, identity timestamps and user ID as its immutable weekly snapshot',()=>{
    let state=createAssessmentWeek('2026-10-26',start,[oldMember()],start);
    state=observeAssessmentWeek(state,start+1,[{...oldMember(),goalSeconds:9999,createdAt:start+1,joinedAt:start+1}]);
    expect(state.roster.one).toMatchObject({goalSeconds:3600,createdAtSnapshot:start-86400000,joinedAtSnapshot:start-3600000,eligible:true});
  });
  it('after-week roster changes cannot retroactively exempt a member or enroll an unseen one',()=>{
    const state=observedWeek();
    const after=observeAssessmentWeek(state,afterWindow,[{...oldMember(),status:'disabled'},oldMember('late')]);
    expect(after.roster.one.eligible).toBe(true);expect(after.roster.late).toBeUndefined();expect(after.coverageTrusted).toBe(true);
    expect(finalizeAssessmentWeek(after,afterWindow,{one:totals(0)}).outcomes.one.status).toBe('failed');
  });
  it('rejects duplicate and unsafe stable user keys',()=>{
    expect(()=>createAssessmentWeek('2026-10-26',start,[oldMember(),oldMember()],start)).toThrow('重复');
    expect(()=>createAssessmentWeek('2026-10-26',start,[oldMember('__proto__')],start)).toThrow('标识');
  });
});

describe('assessment finalization',()=>{
  it('waits until five hours after the week closes, with the exact boundary included',()=>{
    const state=observedWeek();
    expect(finalizeAssessmentWeek(state,afterWindow-1,{one:totals(0)}).outcomes.one.status).toBe('pending');
    expect(finalizeAssessmentWeek(state,afterWindow,{one:totals(0)}).outcomes.one.status).toBe('failed');
  });
  it('clamps only raw+manual and keeps signed entertainment and comprehensive totals',()=>{
    const state=observedWeek();
    expect(finalizeAssessmentWeek(state,afterWindow,{one:totals(1800,-3600,-900)}).outcomes.one).toMatchObject({status:'failed',rawSeconds:1800,manualSeconds:-3600,entertainmentSeconds:-900,comprehensiveSeconds:-900});
    expect(finalizeAssessmentWeek(state,afterWindow,{one:totals(1800,600,1200)}).outcomes.one).toMatchObject({status:'complete',comprehensiveSeconds:3600});
    expect(state.outcomes).toEqual({});
  });
  it.each([undefined,totals(NaN),totals(-1),totals(0,Infinity),totals(0,0,NaN),totals(1.5),totals(Number.MAX_SAFE_INTEGER,1)])('invalid/missing totals remain pending instead of becoming zero ($#)',data=>{
    const state=observedWeek();const result=finalizeAssessmentWeek(state,afterWindow,{one:data});
    expect(result.outcomes.one).toMatchObject({status:'pending',reason:'invalid_totals',comprehensiveSeconds:null,settledAt:null});
  });
  it('an incomplete end-of-week observation remains pending even with zero/valid numeric totals',()=>{
    const state=createAssessmentWeek('2026-10-26',start,[oldMember()],start);
    expect(finalizeAssessmentWeek(state,afterWindow,{one:totals(0)}).outcomes.one).toMatchObject({status:'pending',reason:'incomplete_observation'});
  });
  it('committed complete/failed/exempt outcomes cannot be recalculated by changed totals',()=>{
    const state=observedWeek();const failed=finalizeAssessmentWeek(state,afterWindow,{one:totals(0)});
    const replay=finalizeAssessmentWeek(failed,afterWindow+100,{one:totals(999999)});
    expect(replay.outcomes.one).toEqual(failed.outcomes.one);
    const complete=finalizeAssessmentWeek(state,afterWindow,{one:totals(3600)});
    expect(finalizeAssessmentWeek(complete,afterWindow+100,{}).outcomes.one).toEqual(complete.outcomes.one);
  });
  it('pending missing totals can later receive evidence without rewriting any final outcome',()=>{
    const state=observedWeek();const pending=finalizeAssessmentWeek(state,afterWindow,{});
    const resolved=finalizeAssessmentWeek(pending,afterWindow+1,{one:totals(3600)});
    expect(resolved.outcomes.one.status).toBe('complete');expect(pending.outcomes.one.status).toBe('pending');
  });
  it('does not manufacture outcomes for users absent from the actual roster',()=>{
    expect(finalizeAssessmentWeek(observedWeek(),afterWindow,{ghost:totals(0)}).outcomes.ghost).toBeUndefined();
  });
});
