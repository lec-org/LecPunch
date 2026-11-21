/** LEC 工作室考勤与娱乐称号目录（第一期：11 个自动判定称号）。 */

export type TitleCategory = 'honor' | 'routine' | 'fun' | 'debuff';

export type TitleIconKey =
  | 'crown'
  | 'calendar-check'
  | 'trophy'
  | 'moon'
  | 'sunrise'
  | 'zap'
  | 'crosshair'
  | 'flame'
  | 'egg'
  | 'swords'
  | 'hourglass';

export type TitleThemeKey =
  | 'amber'
  | 'emerald'
  | 'gold'
  | 'indigo'
  | 'sun'
  | 'violet'
  | 'cyan'
  | 'crimson'
  | 'purple'
  | 'rose'
  | 'alert';

export interface TitleDefinition {
  id: string;
  name: string;
  description: string;
  proposer: string;
  category: TitleCategory;
  /** 为 true 时属于强制状态标签（如上周未达标/危急预警），自动亮牌且不占用主荣誉称号槽位。 */
  forced: boolean;
  icon: TitleIconKey;
  theme: TitleThemeKey;
  /** 自动佩戴与展示排序权重（越高越靠前）。 */
  priority: number;
}

export interface MemberTitleBadge {
  id: string;
  name: string;
  description: string;
  proposer: string;
  category: TitleCategory;
  forced: boolean;
  icon: TitleIconKey;
  theme: TitleThemeKey;
}

export interface TitleEvaluationItem extends MemberTitleBadge {
  unlocked: boolean;
  equipped: boolean;
  progressText?: string;
}

export const TITLE_CATALOG: TitleDefinition[] = [
  {
    id: 'punch-star',
    name: '打卡之星',
    description: '连续 3 天成为该年级打卡时长最多的人',
    proposer: '陈信豪',
    category: 'honor',
    forced: false,
    icon: 'crown',
    theme: 'amber',
    priority: 100
  },
  {
    id: 'monthly-perfect',
    name: '全勤之王',
    description: '当月每天打卡超过 1 小时',
    proposer: '陈信豪',
    category: 'honor',
    forced: false,
    icon: 'trophy',
    theme: 'gold',
    priority: 95
  },
  {
    id: 'general-jin',
    name: '金将军',
    description: '当周每天打卡超过 5 小时',
    proposer: '徐绮',
    category: 'honor',
    forced: false,
    icon: 'flame',
    theme: 'crimson',
    priority: 92
  },
  {
    id: 'legend-allnighter',
    name: '传奇耐通王',
    description: '连续 3 天在 00:00–09:00 期间打卡超过 4 小时',
    proposer: '陈信豪',
    category: 'routine',
    forced: false,
    icon: 'zap',
    theme: 'violet',
    priority: 88
  },
  {
    id: 'weekly-perfect',
    name: '全勤之星',
    description: '当周每天打卡超过 1 小时',
    proposer: '陈信豪',
    category: 'honor',
    forced: false,
    icon: 'calendar-check',
    theme: 'emerald',
    priority: 82
  },
  {
    id: 'deadline-master',
    name: '卡点王',
    description: '连续两周综合时长压线达标（目标时长至目标 +1 小时之间）',
    proposer: '陈信豪',
    category: 'fun',
    forced: false,
    icon: 'crosshair',
    theme: 'cyan',
    priority: 76
  },
  {
    id: 'lu-dongbin',
    name: '吕洞宾',
    description: '本周被你先使用过正面效果卡的其他人，之后反手对你使用了负面效果卡',
    proposer: '孟令宇',
    category: 'fun',
    forced: false,
    icon: 'swords',
    theme: 'rose',
    priority: 74
  },
  {
    id: 'early-bird',
    name: '早起鸟',
    description: '连续 3 天在早上 9 点之前签到打卡',
    proposer: '陈信豪',
    category: 'routine',
    forced: false,
    icon: 'sunrise',
    theme: 'sun',
    priority: 68
  },
  {
    id: 'night-owl',
    name: '夜猫子',
    description: '连续 3 天在晚上 9 点之后仍在打卡',
    proposer: '陈信豪',
    category: 'routine',
    forced: false,
    icon: 'moon',
    theme: 'indigo',
    priority: 66
  },
  {
    id: 'lovesick',
    name: '相思了',
    description: '本周还需打卡时间 ÷ 本周剩余时间 ≥ 0.3（补满即可解除）',
    proposer: '黄茂',
    category: 'debuff',
    forced: true,
    icon: 'hourglass',
    theme: 'alert',
    priority: 50
  },
  {
    id: 'purple-egg',
    name: '想吃紫蛋了',
    description: '上周考核未打满目标时长',
    proposer: '杨东明',
    category: 'debuff',
    forced: true,
    icon: 'egg',
    theme: 'purple',
    priority: 45
  }
];

export const TITLE_BY_ID = new Map<string, TitleDefinition>(TITLE_CATALOG.map((item) => [item.id, item]));

export function toMemberTitleBadge(def: TitleDefinition): MemberTitleBadge {
  return {
    id: def.id,
    name: def.name,
    description: def.description,
    proposer: def.proposer,
    category: def.category,
    forced: def.forced,
    icon: def.icon,
    theme: def.theme
  };
}
