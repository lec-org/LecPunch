import type { WeeklyReportFeed } from '@/types';

const REPORTS_MANIFEST_URL = import.meta.env.VITE_REPORTS_MANIFEST_URL as string | undefined;

export const loadWeeklyReports = async (): Promise<{ feed: WeeklyReportFeed | null; connected: boolean }> => {
  if (!REPORTS_MANIFEST_URL) {
    return { feed: null, connected: false };
  }

  const response = await fetch(REPORTS_MANIFEST_URL, { cache: 'no-store' });
  if (!response.ok) {
    throw new Error('统一周报清单暂不可访问');
  }

  return { feed: (await response.json()) as WeeklyReportFeed, connected: true };
};
