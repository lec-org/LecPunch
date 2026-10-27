/** Comprehensive weekly time may be negative; raw session formatting stays unchanged. */
export const formatComprehensiveDuration = (seconds: number) =>
  `${seconds < 0 ? '−' : ''}${formatDuration(Math.abs(seconds))}`;

export const formatDuration = (seconds: number) => {
  const clamped = Math.max(seconds, 0);
  const hours = Math.floor(clamped / 3600)
    .toString()
    .padStart(2, '0');
  const minutes = Math.floor((clamped % 3600) / 60)
    .toString()
    .padStart(2, '0');
  const secs = Math.floor(clamped % 60)
    .toString()
    .padStart(2, '0');
  return `${hours}:${minutes}:${secs}`;
};

const parseWeekKey = (weekKey?: string) => {
  if (!weekKey) {
    return null;
  }

  const [year, month, day] = weekKey.split('-').map(Number);
  if (![year, month, day].every(Number.isFinite)) {
    return null;
  }

  return new Date(Date.UTC(year, month - 1, day));
};

const formatMonthDay = (date: Date) => {
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(date.getUTCDate()).padStart(2, '0');
  return `${mm}-${dd}`;
};

/** Format an ISO date string to a readable local time */
export const formatDateTime = (iso: string) => {
  const d = new Date(iso);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return `${mm}-${dd} ${hh}:${min}:${ss}`;
};

/**
 * Convert a selectedWeek key to the Monday-based weekKey string (yyyy-MM-dd).
 * 'current' -> this week's Monday, 'prev1' -> last Monday, etc.
 */
export const weekKeyFromOffset = (offset: number): string => {
  const now = new Date();
  const shanghaiOffset = 8 * 60;
  const localOffset = now.getTimezoneOffset();
  const shanghaiMs = now.getTime() + (shanghaiOffset + localOffset) * 60 * 1000;
  const sh = new Date(shanghaiMs);

  const dow = (sh.getDay() + 6) % 7;
  const monday = new Date(sh);
  monday.setDate(sh.getDate() - dow - offset * 7);

  const yyyy = monday.getFullYear();
  const mm = String(monday.getMonth() + 1).padStart(2, '0');
  const dd = String(monday.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
};

const WEEK_OFFSETS: Record<string, number> = {
  current: 0,
  prev1: 1,
  prev2: 2,
  prev3: 3
};

export const selectedWeekToKey = (selectedWeek: string): string =>
  weekKeyFromOffset(WEEK_OFFSETS[selectedWeek] ?? 0);

export const formatWeekRangeLabel = (weekKey: string) => {
  const start = parseWeekKey(weekKey);
  if (!start) {
    return '-';
  }

  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 6);
  return `${formatMonthDay(start)} ~ ${formatMonthDay(end)}`;
};

export const isCurrentWeekKey = (weekKey?: string) => !!weekKey && weekKey === weekKeyFromOffset(0);
