/** 称号系统纯计算引擎（无数据库依赖，统一按 Asia/Shanghai 自然日与考核周评估全部 11 个称号）。 */
import { TIMEZONE, comprehensiveDurationSeconds, weeklyGoalSeconds } from '@lecpunch/shared';
import { DateTime } from 'luxon';
import {
  TITLE_CATALOG,
  toMemberTitleBadge,
  type MemberTitleBadge,
  type TitleEvaluationItem
} from './title-catalog';

const MAX_VALID_SESSION_SECONDS = 18_000;
const ONE_HOUR_SECONDS = 3_600;
const FOUR_HOURS_SECONDS = 4 * 3_600;
const FIVE_HOURS_SECONDS = 5 * 3_600;

export interface TitleEngineMember {
  id: string;
  enrollYear: number;
  createdAt?: Date;
  equippedTitleId?: string | null;
}

export interface TitleEngineSession {
  userId: string;
  checkInAt: Date;
  checkOutAt?: Date;
  durationSeconds?: number;
  status: 'active' | 'completed' | 'invalidated';
  weekKey: string;
}

export interface TitleEngineCardInteraction {
  actorId: string;
  targetId: string;
  polarity: 'positive' | 'negative';
  atMs: number;
}

export interface EvaluateTeamTitlesInput {
  now: Date;
  members: TitleEngineMember[];
  sessions: TitleEngineSession[];
  /** key 格式：`${userId}:${weekKey}` → 手动补正总秒数。 */
  manualAdjustmentsByUserWeek: Map<string, number>;
  /** key 格式：`${userId}:${weekKey}` → 卡牌娱乐时长总秒数。 */
  entertainmentByUserWeek: Map<string, number>;
  /** 本周发生的跨人卡牌正/负面交互事件。 */
  currentWeekCardInteractions: TitleEngineCardInteraction[];
}

export interface MemberTitleEvaluation {
  equippedTitleId: string | null;
  displayTitles: MemberTitleBadge[];
  catalog: TitleEvaluationItem[];
}

function dayKeyOf(dt: DateTime): string {
  return dt.toFormat('yyyy-LL-dd');
}

function weekKeyOf(dt: DateTime): string {
  return dt.startOf('day').minus({ days: dt.weekday - 1 }).toFormat('yyyy-LL-dd');
}

function addDays(dayKey: string, delta: number): string {
  return DateTime.fromISO(dayKey, { zone: TIMEZONE }).plus({ days: delta }).toFormat('yyyy-LL-dd');
}

/** 计算区间 [startMs, endMs] 与 [winStartMs, winEndMs] 的重叠秒数。 */
function overlapSeconds(startMs: number, endMs: number, winStartMs: number, winEndMs: number): number {
  const s = Math.max(startMs, winStartMs);
  const e = Math.min(endMs, winEndMs);
  return e > s ? Math.floor((e - s) / 1000) : 0;
}

/** 计算一组已满足条件的日期集合中，截止在 [anchorEndDay - maxAgeDays, anchorEndDay] 内的最长连续天数。 */
function bestRecentConsecutiveStreak(
  days: Set<string>,
  anchorDay: string,
  maxLookbackDays = 60,
  maxEndAgeDays = 1
): { qualified3: boolean; currentStreak: number } {
  // 计算截止今天（或昨天）的当前连击，用于进度展示
  let currentStreak = 0;
  const startFrom = days.has(anchorDay) ? anchorDay : addDays(anchorDay, -1);
  let cursor = startFrom;
  while (days.has(cursor) && currentStreak < maxLookbackDays) {
    currentStreak += 1;
    cursor = addDays(cursor, -1);
  }

  // 检查是否存在结束于 [anchorDay - maxEndAgeDays, anchorDay] 且长度 >= 3 的连续 3 天
  let qualified3 = false;
  for (let age = 0; age <= maxEndAgeDays; age += 1) {
    const endDay = addDays(anchorDay, -age);
    if (days.has(endDay) && days.has(addDays(endDay, -1)) && days.has(addDays(endDay, -2))) {
      qualified3 = true;
      break;
    }
  }
  return { qualified3, currentStreak };
}

/** 将一条有效/进行中会话拆解到涉及的上海自然日上，精确累加日时长、夜猫子、早起鸟与凌晨耐通窗口。 */
interface UserDailyMetrics {
  /** 每天有效打卡总秒数（仅计入未作废会话）。 */
  dailySeconds: Map<string, number>;
  /** 晚上 21:00 后仍在打卡的日期集合。 */
  nightOwlDays: Set<string>;
  /** 早上 05:00~09:00 前签到的日期集合。 */
  earlyBirdDays: Set<string>;
  /** 每天 00:00~09:00 窗口内的打卡重叠总秒数。 */
  overnightSeconds: Map<string, number>;
  /** 按 weekKey 聚合的有效打卡总秒数（不含当前进行中会话，与周榜口径保持一致；当前进行中另计）。 */
  recordedByWeek: Map<string, number>;
  /** 本周进行中会话实时累计秒数。 */
  activeCurrentWeekSeconds: number;
}

function emptyMetrics(): UserDailyMetrics {
  return {
    dailySeconds: new Map(),
    nightOwlDays: new Set(),
    earlyBirdDays: new Set(),
    overnightSeconds: new Map(),
    recordedByWeek: new Map(),
    activeCurrentWeekSeconds: 0
  };
}

export function evaluateTeamTitles(input: EvaluateTeamTitlesInput): Map<string, MemberTitleEvaluation> {
  const nowDt = DateTime.fromJSDate(input.now, { zone: TIMEZONE });
  const nowMs = input.now.getTime();
  const todayKey = dayKeyOf(nowDt);
  const currentWeekKey = weekKeyOf(nowDt);
  const currentWeekStart = DateTime.fromISO(currentWeekKey, { zone: TIMEZONE }).startOf('day');
  const currentWeekEnd = currentWeekStart.plus({ days: 7 });
  const prevWeek1Key = currentWeekStart.minus({ days: 7 }).toFormat('yyyy-LL-dd');
  const prevWeek2Key = currentWeekStart.minus({ days: 14 }).toFormat('yyyy-LL-dd');
  const prevWeek1EndMs = currentWeekStart.toMillis();

  // 当前月与上个月的日期列表
  const curMonthStart = nowDt.startOf('month');
  const curMonthDaysCount = nowDt.daysInMonth ?? 30;
  const prevMonthStart = curMonthStart.minus({ months: 1 });
  const prevMonthDaysCount = prevMonthStart.daysInMonth ?? 30;

  const currentWeekDayKeys = Array.from({ length: 7 }, (_, i) =>
    currentWeekStart.plus({ days: i }).toFormat('yyyy-LL-dd')
  );
  const prevWeek1DayKeys = Array.from({ length: 7 }, (_, i) =>
    currentWeekStart.minus({ days: 7 - i }).toFormat('yyyy-LL-dd')
  );
  const curMonthDayKeys = Array.from({ length: curMonthDaysCount }, (_, i) =>
    curMonthStart.plus({ days: i }).toFormat('yyyy-LL-dd')
  );
  const prevMonthDayKeys = Array.from({ length: prevMonthDaysCount }, (_, i) =>
    prevMonthStart.plus({ days: i }).toFormat('yyyy-LL-dd')
  );

  const metricsByUser = new Map<string, UserDailyMetrics>();
  const memberById = new Map<string, TitleEngineMember>();
  for (const member of input.members) {
    memberById.set(member.id, member);
    metricsByUser.set(member.id, emptyMetrics());
  }

  for (const session of input.sessions) {
    const metrics = metricsByUser.get(session.userId);
    if (!metrics) continue;
    if (session.status === 'invalidated') continue;

    const startDt = DateTime.fromJSDate(session.checkInAt, { zone: TIMEZONE });
    const startMs = session.checkInAt.getTime();

    let effectiveEndMs: number;
    let validDuration: number;

    if (session.status === 'completed') {
      const dur = session.durationSeconds ?? 0;
      if (dur <= 0 || dur >= MAX_VALID_SESSION_SECONDS) continue;
      validDuration = dur;
      effectiveEndMs = session.checkOutAt ? session.checkOutAt.getTime() : startMs + dur * 1000;
      metrics.recordedByWeek.set(
        session.weekKey,
        (metrics.recordedByWeek.get(session.weekKey) ?? 0) + dur
      );
    } else {
      // 进行中会话：实时计入（上限裁切至 < 5h 以免挂机虚高）
      const elapsed = Math.max(0, Math.floor((nowMs - startMs) / 1000));
      if (elapsed >= MAX_VALID_SESSION_SECONDS) continue;
      validDuration = elapsed;
      effectiveEndMs = nowMs;
      if (session.weekKey === currentWeekKey) {
        metrics.activeCurrentWeekSeconds += elapsed;
      }
    }

    const startDayKey = dayKeyOf(startDt);

    // 1. 早起鸟：上海时间 05:00 <= checkIn < 09:00
    if (startDt.hour >= 5 && startDt.hour < 9) {
      metrics.earlyBirdDays.add(startDayKey);
    }

    // 按跨天拆分区间，精确累计每天时长、夜猫子（21:00 后仍在岗）与 00:00~09:00 耐通窗口
    const endDt = DateTime.fromMillis(effectiveEndMs, { zone: TIMEZONE });
    let dayCursor = startDt.startOf('day');
    const lastDay = endDt.startOf('day');
    let guard = 0;

    while (dayCursor <= lastDay && guard < 3) {
      guard += 1;
      const dKey = dayKeyOf(dayCursor);
      const dStartMs = dayCursor.toMillis();
      const dEndMs = dayCursor.plus({ days: 1 }).toMillis();

      // 优先用时间重叠拆分；若历史数据 checkOutAt 缺失但有 durationSeconds，则归入签到日
      const segSec =
        effectiveEndMs > startMs
          ? overlapSeconds(startMs, effectiveEndMs, dStartMs, dEndMs)
          : dKey === startDayKey
            ? validDuration
            : 0;
      if (segSec > 0) {
        metrics.dailySeconds.set(dKey, (metrics.dailySeconds.get(dKey) ?? 0) + segSec);
      }

      // 夜猫子：与当天 [21:00, 24:00) 存在重叠，或签到时间即在 21:00 之后
      const nightStartMs = dayCursor.plus({ hours: 21 }).toMillis();
      if (effectiveEndMs >= nightStartMs && startMs < dEndMs) {
        if (effectiveEndMs > nightStartMs || startMs >= nightStartMs) {
          metrics.nightOwlDays.add(dKey);
        }
      }

      // 传奇耐通王：与当天 [00:00, 09:00] 窗口的重叠秒数
      const dawnEndMs = dayCursor.plus({ hours: 9 }).toMillis();
      const dawnSec = overlapSeconds(startMs, effectiveEndMs, dStartMs, dawnEndMs);
      if (dawnSec > 0) {
        metrics.overnightSeconds.set(dKey, (metrics.overnightSeconds.get(dKey) ?? 0) + dawnSec);
      }

      dayCursor = dayCursor.plus({ days: 1 });
    }
  }

  // 计算「打卡之星」所需：每个年级每一天的最高打卡秒数
  const gradeDailyMax = new Map<string, number>(); // `${enrollYear}:${dayKey}` -> maxSeconds
  for (const member of input.members) {
    const metrics = metricsByUser.get(member.id)!;
    for (const [dKey, sec] of metrics.dailySeconds.entries()) {
      if (sec <= 0) continue;
      const gKey = `${member.enrollYear}:${dKey}`;
      const prev = gradeDailyMax.get(gKey) ?? 0;
      if (sec > prev) gradeDailyMax.set(gKey, sec);
    }
  }

  // 计算「吕洞宾」：本周 A 对 B 使用过正面卡，随后 B 对 A 使用过负面卡 -> A 解锁
  const luDongbinUsers = new Set<string>();
  const sortedInteractions = [...input.currentWeekCardInteractions].sort((a, b) => a.atMs - b.atMs);
  const earliestPositiveAt = new Map<string, number>(); // `${actor}->${target}` -> earliestMs
  for (const evt of sortedInteractions) {
    if (evt.actorId === evt.targetId) continue;
    if (evt.polarity === 'positive') {
      const pairKey = `${evt.actorId}->${evt.targetId}`;
      if (!earliestPositiveAt.has(pairKey)) {
        earliestPositiveAt.set(pairKey, evt.atMs);
      }
    } else if (evt.polarity === 'negative') {
      // 检查被攻击者 target 是否曾在本周早些时候对攻击者 actor 用过正面卡
      const reversePairKey = `${evt.targetId}->${evt.actorId}`;
      const helpedAt = earliestPositiveAt.get(reversePairKey);
      if (helpedAt !== undefined && evt.atMs > helpedAt) {
        luDongbinUsers.add(evt.targetId);
      }
    }
  }

  const getWeekTotal = (userId: string, weekKey: string, includeActive = false): number => {
    const metrics = metricsByUser.get(userId)!;
    const recorded =
      (metrics.recordedByWeek.get(weekKey) ?? 0) +
      (includeActive && weekKey === currentWeekKey ? metrics.activeCurrentWeekSeconds : 0);
    const manual = input.manualAdjustmentsByUserWeek.get(`${userId}:${weekKey}`) ?? 0;
    const ent = input.entertainmentByUserWeek.get(`${userId}:${weekKey}`) ?? 0;
    return comprehensiveDurationSeconds(recorded, manual, ent);
  };

  const results = new Map<string, MemberTitleEvaluation>();
  const remainingWeekSeconds = Math.max(0, Math.floor((currentWeekEnd.toMillis() - nowMs) / 1000));

  for (const member of input.members) {
    const metrics = metricsByUser.get(member.id)!;
    const goalSeconds = weeklyGoalSeconds(member.enrollYear);

    // 1. 打卡之星：连续 3 天成为该年级单日第一（结束于近 7 天内）
    const topGradeDays = new Set<string>();
    for (const [dKey, sec] of metrics.dailySeconds.entries()) {
      if (sec <= 0) continue;
      const maxSec = gradeDailyMax.get(`${member.enrollYear}:${dKey}`) ?? 0;
      if (maxSec > 0 && sec >= maxSec) {
        topGradeDays.add(dKey);
      }
    }
    const punchStarRes = bestRecentConsecutiveStreak(topGradeDays, todayKey, 30, 6);

    // 2. 全勤之星：当周每天 > 1h（本周全部 7 天达标，或刚结束的上一周全部 7 天达标）
    const curWeekDaysOver1h = currentWeekDayKeys.filter(
      (d) => (metrics.dailySeconds.get(d) ?? 0) >= ONE_HOUR_SECONDS
    ).length;
    const prevWeekDaysOver1h = prevWeek1DayKeys.filter(
      (d) => (metrics.dailySeconds.get(d) ?? 0) >= ONE_HOUR_SECONDS
    ).length;
    const weeklyPerfectUnlocked = curWeekDaysOver1h >= 7 || prevWeekDaysOver1h >= 7;

    // 3. 全勤之王：当月每天 > 1h（本月全部天达标，或刚结束的上个月全部天达标）
    const curMonthDaysOver1h = curMonthDayKeys.filter(
      (d) => (metrics.dailySeconds.get(d) ?? 0) >= ONE_HOUR_SECONDS
    ).length;
    const prevMonthDaysOver1h = prevMonthDayKeys.filter(
      (d) => (metrics.dailySeconds.get(d) ?? 0) >= ONE_HOUR_SECONDS
    ).length;
    const monthlyPerfectUnlocked =
      curMonthDaysOver1h >= curMonthDaysCount || prevMonthDaysOver1h >= prevMonthDaysCount;

    // 4. 夜猫子：连续 3 天 21:00 后仍在打卡（截止今天或昨天）
    const nightOwlRes = bestRecentConsecutiveStreak(metrics.nightOwlDays, todayKey, 30, 1);

    // 5. 早起鸟：连续 3 天 09:00 前打卡（截止今天或昨天）
    const earlyBirdRes = bestRecentConsecutiveStreak(metrics.earlyBirdDays, todayKey, 30, 1);

    // 6. 传奇耐通王：连续 3 天 00:00~09:00 打卡 > 4h（结束于近 7 天内）
    const allNighterDays = new Set<string>();
    for (const [dKey, sec] of metrics.overnightSeconds.entries()) {
      if (sec >= FOUR_HOURS_SECONDS) {
        allNighterDays.add(dKey);
      }
    }
    const allNighterRes = bestRecentConsecutiveStreak(allNighterDays, todayKey, 30, 6);

    // 7. 卡点王：连续两周综合时长在 [goal, goal + 1h] 之间
    const prev1Total = getWeekTotal(member.id, prevWeek1Key);
    const prev2Total = getWeekTotal(member.id, prevWeek2Key);
    const prev1Hit = prev1Total >= goalSeconds && prev1Total <= goalSeconds + ONE_HOUR_SECONDS;
    const prev2Hit = prev2Total >= goalSeconds && prev2Total <= goalSeconds + ONE_HOUR_SECONDS;
    const deadlineMasterUnlocked = prev1Hit && prev2Hit;

    // 8. 金将军：当周每天 > 5h（本周 7 天或上周 7 天均 >= 5h）
    const curWeekDaysOver5h = currentWeekDayKeys.filter(
      (d) => (metrics.dailySeconds.get(d) ?? 0) >= FIVE_HOURS_SECONDS
    ).length;
    const prevWeekDaysOver5h = prevWeek1DayKeys.filter(
      (d) => (metrics.dailySeconds.get(d) ?? 0) >= FIVE_HOURS_SECONDS
    ).length;
    const generalJinUnlocked = curWeekDaysOver5h >= 7 || prevWeekDaysOver5h >= 7;

    // 9. 想吃紫蛋了：上周未打满卡（排除上周结束后才新注册的成员）
    const existedLastWeek = !member.createdAt || member.createdAt.getTime() < prevWeek1EndMs;
    const purpleEggActive = existedLastWeek && prev1Total < goalSeconds;

    // 10. 吕洞宾：本周被你给过正面卡的人反手对你用负面卡
    const luDongbinUnlocked = luDongbinUsers.has(member.id);

    // 11. 相思了：还需打卡时间 / 本周剩余时间 >= 0.3
    const currentWeekTotal = getWeekTotal(member.id, currentWeekKey, true);
    const remainingGoalSeconds = Math.max(0, goalSeconds - currentWeekTotal);
    const pressureRatio =
      remainingGoalSeconds <= 0
        ? 0
        : remainingWeekSeconds <= 0
          ? 1
          : remainingGoalSeconds / remainingWeekSeconds;
    const lovesickActive = remainingGoalSeconds > 0 && pressureRatio >= 0.3;

    const statusById: Record<string, { unlocked: boolean; progressText?: string }> = {
      'punch-star': {
        unlocked: punchStarRes.qualified3,
        progressText: punchStarRes.qualified3
          ? '已达成连续 3 天年级榜首'
          : `当前连霸 ${Math.min(3, punchStarRes.currentStreak)}/3 天`
      },
      'monthly-perfect': {
        unlocked: monthlyPerfectUnlocked,
        progressText: monthlyPerfectUnlocked
          ? '已达成整月全勤'
          : `本月已达标 ${curMonthDaysOver1h}/${curMonthDaysCount} 天`
      },
      'general-jin': {
        unlocked: generalJinUnlocked,
        progressText: generalJinUnlocked
          ? '已达成整周每日 5 小时'
          : `本周 ${curWeekDaysOver5h}/7 天超过 5 小时`
      },
      'legend-allnighter': {
        unlocked: allNighterRes.qualified3,
        progressText: allNighterRes.qualified3
          ? '已达成连续 3 天通宵战绩'
          : `当前连续 ${Math.min(3, allNighterRes.currentStreak)}/3 天`
      },
      'weekly-perfect': {
        unlocked: weeklyPerfectUnlocked,
        progressText: weeklyPerfectUnlocked
          ? '已达成整周每日 1 小时'
          : `本周 ${curWeekDaysOver1h}/7 天超过 1 小时`
      },
      'deadline-master': {
        unlocked: deadlineMasterUnlocked,
        progressText: deadlineMasterUnlocked
          ? '已连续 2 周精准压线'
          : prev1Hit
            ? '上周已压线（1/2 周）'
            : `目标区间 ${Math.round(goalSeconds / 3600)}–${Math.round(goalSeconds / 3600) + 1} 小时`
      },
      'lu-dongbin': {
        unlocked: luDongbinUnlocked,
        progressText: luDongbinUnlocked ? '本周惨遭恩将仇报' : '本周尚未触发卡牌背刺事件'
      },
      'early-bird': {
        unlocked: earlyBirdRes.qualified3,
        progressText: earlyBirdRes.qualified3
          ? '已连续 3 天 9 点前打卡'
          : `当前连续 ${Math.min(3, earlyBirdRes.currentStreak)}/3 天`
      },
      'night-owl': {
        unlocked: nightOwlRes.qualified3,
        progressText: nightOwlRes.qualified3
          ? '已连续 3 天 21 点后在岗'
          : `当前连续 ${Math.min(3, nightOwlRes.currentStreak)}/3 天`
      },
      lovesick: {
        unlocked: lovesickActive,
        progressText:
          remainingGoalSeconds <= 0
            ? '本周已达标，毫无相思'
            : `当前欠账占比 ${Math.min(100, Math.round(pressureRatio * 100))}%（≥ 30% 触发）`
      },
      'purple-egg': {
        unlocked: purpleEggActive,
        progressText: purpleEggActive
          ? `上周完成 ${(prev1Total / 3600).toFixed(1)}h / ${Math.round(goalSeconds / 3600)}h`
          : existedLastWeek
            ? '上周已顺利达标'
            : '新成员首周免挂紫蛋'
      }
    };

    const unlockedNonForced = TITLE_CATALOG.filter(
      (def) => !def.forced && statusById[def.id]?.unlocked
    ).sort((a, b) => b.priority - a.priority);

    const requestedEquip = member.equippedTitleId ?? null;
    const validEquipped = requestedEquip
      ? unlockedNonForced.find((def) => def.id === requestedEquip) ?? null
      : null;
    const activePrimary = validEquipped ?? unlockedNonForced[0] ?? null;

    const activeForced = TITLE_CATALOG.filter(
      (def) => def.forced && statusById[def.id]?.unlocked
    ).sort((a, b) => b.priority - a.priority);

    const displayTitles: MemberTitleBadge[] = [
      ...(activePrimary ? [toMemberTitleBadge(activePrimary)] : []),
      ...activeForced.map(toMemberTitleBadge)
    ];

    const catalog: TitleEvaluationItem[] = TITLE_CATALOG.map((def) => {
      const st = statusById[def.id] ?? { unlocked: false };
      return {
        ...toMemberTitleBadge(def),
        unlocked: st.unlocked,
        equipped: Boolean(
          (activePrimary && activePrimary.id === def.id) || (def.forced && st.unlocked)
        ),
        progressText: st.progressText
      };
    });

    results.set(member.id, {
      equippedTitleId: validEquipped?.id ?? null,
      displayTitles,
      catalog
    });
  }

  return results;
}
