import { describe, expect, it } from 'vitest';
import { DateTime } from 'luxon';
import { TIMEZONE } from '@lecpunch/shared';
import { evaluateTeamTitles, type TitleEngineSession } from './title-engine';
import { extractCardInteractionsFromReceipt } from './titles.service';

function shDate(iso: string): Date {
  return DateTime.fromISO(iso, { zone: TIMEZONE }).toJSDate();
}

function weekKeyOf(iso: string): string {
  const dt = DateTime.fromISO(iso, { zone: TIMEZONE });
  return dt.startOf('day').minus({ days: dt.weekday - 1 }).toFormat('yyyy-LL-dd');
}

function makeSession(userId: string, startIso: string, hours: number): TitleEngineSession {
  const start = shDate(startIso);
  const durationSeconds = Math.round(hours * 3600);
  const end = new Date(start.getTime() + durationSeconds * 1000);
  return {
    userId,
    checkInAt: start,
    checkOutAt: end,
    durationSeconds,
    status: 'completed',
    weekKey: weekKeyOf(startIso)
  };
}

describe('title-engine (LEC 工作室第一期 11 项自动称号)', () => {
  it('正确判定打卡之星、早起鸟、夜猫子、传奇耐通王与佩戴优先级', () => {
    // 2026-11-21 是周六
    const now = shDate('2026-11-21T15:00:00');
    const sessions: TitleEngineSession[] = [
      // Alice (2025 级)：连续 3 天年级第一 + 连续 3 天早起(08:00) + 连续 3 天夜猫子(21:00 后仍在)
      makeSession('alice', '2026-11-19T08:00:00', 3),
      makeSession('alice', '2026-11-19T19:00:00', 3), // 结束于 22:00
      makeSession('alice', '2026-11-20T08:15:00', 3),
      makeSession('alice', '2026-11-20T20:00:00', 2), // 结束于 22:00
      makeSession('alice', '2026-11-21T08:30:00', 3),
      makeSession('alice', '2026-11-21T21:10:00', 2),

      // Bob (2025 级)：连续 3 天凌晨 01:00–05:30 通宵 (>4h) -> 传奇耐通王，但日总时长低于 Alice 不是打卡之星
      makeSession('bob', '2026-11-19T01:00:00', 4.5),
      makeSession('bob', '2026-11-20T01:00:00', 4.5),
      makeSession('bob', '2026-11-21T01:00:00', 4.5)
    ];

    const res = evaluateTeamTitles({
      now,
      members: [
        { id: 'alice', enrollYear: 2025, createdAt: shDate('2026-09-01T00:00:00'), equippedTitleId: 'early-bird' },
        { id: 'bob', enrollYear: 2025, createdAt: shDate('2026-09-01T00:00:00') }
      ],
      sessions,
      manualAdjustmentsByUserWeek: new Map(),
      entertainmentByUserWeek: new Map(),
      currentWeekCardInteractions: []
    });

    const alice = res.get('alice')!;
    const aliceUnlocked = new Set(alice.catalog.filter((c) => c.unlocked).map((c) => c.id));
    expect(aliceUnlocked.has('punch-star')).toBe(true);
    expect(aliceUnlocked.has('early-bird')).toBe(true);
    expect(aliceUnlocked.has('night-owl')).toBe(true);
    expect(aliceUnlocked.has('legend-allnighter')).toBe(false);
    // Alice 手动佩戴了 early-bird，主展示应优先 early-bird
    expect(alice.equippedTitleId).toBe('early-bird');
    expect(alice.displayTitles[0]?.id).toBe('early-bird');

    const bob = res.get('bob')!;
    const bobUnlocked = new Set(bob.catalog.filter((c) => c.unlocked).map((c) => c.id));
    expect(bobUnlocked.has('legend-allnighter')).toBe(true);
    // 凌晨 01:00 打卡不应误判为早起鸟（限定 05:00~09:00）
    expect(bobUnlocked.has('early-bird')).toBe(false);
    expect(bobUnlocked.has('punch-star')).toBe(false);
    expect(bob.displayTitles[0]?.id).toBe('legend-allnighter');
  });

  it('正确判定全勤之星、全勤之王、金将军、卡点王、想吃紫蛋了与相思了', () => {
    // 2026-11-22 周日 14:00（本周仅剩 10 小时）
    const now = shDate('2026-11-22T14:00:00');
    const sessions: TitleEngineSession[] = [];

    // 1. 全勤之王 + 金将军：上个月（2026-10，31天）每天 2h；本周 7 天每天 2 段共 6h
    for (let day = 1; day <= 31; day += 1) {
      sessions.push(makeSession('king', `2026-10-${String(day).padStart(2, '0')}T10:00:00`, 2));
    }
    for (let day = 16; day <= 22; day += 1) {
      sessions.push(makeSession('king', `2026-11-${String(day).padStart(2, '0')}T09:00:00`, 3));
      sessions.push(makeSession('king', `2026-11-${String(day).padStart(2, '0')}T14:00:00`, 3));
    }

    // 2. 卡点王：2026 级周目标 28h，连续两周（2026-11-02、2026-11-09）均正好 28.5h
    const prev2WeekDays = ['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06', '2026-11-07', '2026-11-08'];
    const prev1WeekDays = ['2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13', '2026-11-14', '2026-11-15'];
    for (const d of [...prev2WeekDays, ...prev1WeekDays]) {
      sessions.push(makeSession('sniper', `${d}T10:00:00`, 4)); // 7 * 4 = 28h
    }
    sessions.push(makeSession('sniper', '2026-11-08T15:00:00', 0.5)); // 28.5h
    sessions.push(makeSession('sniper', '2026-11-15T15:00:00', 0.5)); // 28.5h

    // 3. 紫蛋 + 相思了：上周 0h，本周 20h（2026 级还差 8h，本周仅剩 10h -> 8/10 = 0.8 >= 0.3）
    for (let day = 16; day <= 20; day += 1) {
      sessions.push(makeSession('slacker', `2026-11-${String(day).padStart(2, '0')}T10:00:00`, 4));
    }

    const res = evaluateTeamTitles({
      now,
      members: [
        { id: 'king', enrollYear: 2026, createdAt: shDate('2026-09-01T00:00:00') },
        { id: 'sniper', enrollYear: 2026, createdAt: shDate('2026-09-01T00:00:00') },
        { id: 'slacker', enrollYear: 2026, createdAt: shDate('2026-09-01T00:00:00') },
        // 新注册成员本周才加入，不应被挂上周紫蛋
        { id: 'newbie', enrollYear: 2026, createdAt: shDate('2026-11-20T10:00:00') }
      ],
      sessions,
      manualAdjustmentsByUserWeek: new Map(),
      entertainmentByUserWeek: new Map(),
      currentWeekCardInteractions: []
    });

    const kingSet = new Set(res.get('king')!.catalog.filter((c) => c.unlocked).map((c) => c.id));
    expect(kingSet.has('monthly-perfect')).toBe(true);
    expect(kingSet.has('weekly-perfect')).toBe(true);
    expect(kingSet.has('general-jin')).toBe(true);
    expect(kingSet.has('lovesick')).toBe(false);

    const sniperSet = new Set(res.get('sniper')!.catalog.filter((c) => c.unlocked).map((c) => c.id));
    expect(sniperSet.has('deadline-master')).toBe(true);
    expect(sniperSet.has('purple-egg')).toBe(false);

    const slacker = res.get('slacker')!;
    const slackerDisplayIds = slacker.displayTitles.map((t) => t.id);
    expect(slackerDisplayIds).toContain('purple-egg');
    expect(slackerDisplayIds).toContain('lovesick');

    const newbieSet = new Set(res.get('newbie')!.catalog.filter((c) => c.unlocked).map((c) => c.id));
    expect(newbieSet.has('purple-egg')).toBe(false);
    expect(newbieSet.has('lovesick')).toBe(true);
  });

  it('正确判定「吕洞宾」（先正面后反手负面才触发，反向顺序不触发）', () => {
    const now = shDate('2026-11-21T18:00:00');
    const interactions = [
      // Alice 10:00 给 Bob 加时卡（正面）
      ...extractCardInteractionsFromReceipt({
        actorId: 'alice',
        at: '2026-11-21T02:00:00.000Z',
        result: {
          action: 'use',
          message: '加时',
          actionCard: { id: 'card-05', name: '加时卡', rarity: 'R' },
          effects: [
            {
              target: { id: 'bob', username: 'bob', displayName: 'Bob' },
              outcome: 'applied',
              kind: 'time',
              deltaSeconds: 1800
            }
          ]
        }
      }),
      // Bob 12:00 对 Alice 用红桃 K（负面） -> Alice 成为吕洞宾
      ...extractCardInteractionsFromReceipt({
        actorId: 'bob',
        at: '2026-11-21T04:00:00.000Z',
        result: {
          action: 'use',
          message: '红桃 K',
          actionCard: { id: 'card-18', name: '红桃 K', rarity: 'SR' },
          effects: [
            {
              target: { id: 'alice', username: 'alice', displayName: 'Alice' },
              outcome: 'applied',
              kind: 'time',
              deltaSeconds: -1800
            }
          ]
        }
      }),
      // Carol 先攻击 Dave，后来 Dave 给 Carol 赠卡 -> Carol 不应解锁吕洞宾
      ...extractCardInteractionsFromReceipt({
        actorId: 'carol',
        at: '2026-11-21T01:00:00.000Z',
        result: {
          action: 'use',
          message: '乐不思蜀',
          actionCard: { id: 'card-10', name: '乐不思蜀', rarity: 'R' },
          effects: [
            {
              target: { id: 'dave', username: 'dave', displayName: 'Dave' },
              outcome: 'applied',
              kind: 'status'
            }
          ]
        }
      }),
      ...extractCardInteractionsFromReceipt({
        actorId: 'dave',
        at: '2026-11-21T03:00:00.000Z',
        result: { action: 'gift', message: '赠卡' },
        gift: {
          recipientId: 'carol',
          notice: {
            at: '2026-11-21T03:00:00.000Z',
            sender: { id: 'dave', username: 'dave', displayName: 'Dave' },
            card: { id: 'card-01', name: '加速', rarity: 'N' }
          }
        }
      })
    ];

    const res = evaluateTeamTitles({
      now,
      members: [
        { id: 'alice', enrollYear: 2026 },
        { id: 'bob', enrollYear: 2026 },
        { id: 'carol', enrollYear: 2026 },
        { id: 'dave', enrollYear: 2026 }
      ],
      sessions: [],
      manualAdjustmentsByUserWeek: new Map(),
      entertainmentByUserWeek: new Map(),
      currentWeekCardInteractions: interactions
    });

    expect(res.get('alice')!.catalog.find((c) => c.id === 'lu-dongbin')?.unlocked).toBe(true);
    expect(res.get('bob')!.catalog.find((c) => c.id === 'lu-dongbin')?.unlocked).toBe(false);
    expect(res.get('carol')!.catalog.find((c) => c.id === 'lu-dongbin')?.unlocked).toBe(false);
    expect(res.get('dave')!.catalog.find((c) => c.id === 'lu-dongbin')?.unlocked).toBe(false);
  });
});
