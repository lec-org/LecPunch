import { useCallback, useMemo } from 'react';
import { Badge, Button, DataTable, Progress, type ColumnDef } from '@lecpunch/ui';
import type { WeeklyStatItem } from '@lecpunch/shared';
import { CartesianGrid, Legend, Line, LineChart, Tooltip, XAxis, YAxis } from 'recharts';
import { getMyWeeklyStats } from '@/features/stats/stats.api';
import { useAsyncData } from '@/shared/hooks/useAsyncData';
import { getApiErrorMessage } from '@/shared/lib/api-error';
import {
  CHART_COLORS,
  CHART_TOOLTIP_CONTENT_STYLE,
  CHART_TOOLTIP_ITEM_STYLE,
  CHART_TOOLTIP_LABEL_STYLE,
  formatWeekKeyForAxis
} from '@/shared/lib/chart';
import { formatComprehensiveDuration, formatComprehensiveHours, formatDuration, formatWeekRangeLabel, isCurrentWeekKey } from '@/shared/lib/time';
import { PageSection } from '@/shared/ui/PageSection';
import { PageState } from '@/shared/ui/PageState';

export const WeeklyHistoryPage = () => {
  const fetchWeeklyHistory = useCallback(async (_signal: AbortSignal) => getMyWeeklyStats(), []);
  const { data, loading, error, refresh } = useAsyncData(fetchWeeklyHistory, [], {
    initialData: {
      items: [] as WeeklyStatItem[],
      weeklyGoalSeconds: 0
    }
  });
  const weeklyStats = data.items;
  const weeklyGoalSeconds = data.weeklyGoalSeconds;
  const loadError = error ? getApiErrorMessage(error, '加载周历史统计失败') : null;
  const trendData = useMemo(
    () =>
      [...weeklyStats].reverse().map((item) => ({
        weekKey: item.weekKey,
        axisWeekLabel: formatWeekKeyForAxis(item.weekKey),
        totalDurationSeconds: item.totalDurationSeconds,
        goalSeconds: item.weeklyGoalSeconds || weeklyGoalSeconds
      })),
    [weeklyStats, weeklyGoalSeconds]
  );
  const averageDurationSeconds = useMemo(() => {
    if (trendData.length === 0) {
      return 0;
    }

    const total = trendData.reduce((sum, point) => sum + point.totalDurationSeconds, 0);
    return Math.floor(total / trendData.length);
  }, [trendData]);

  const columns: ColumnDef<WeeklyStatItem>[] = [
    {
      key: 'weekKey',
      header: '周标识',
      cellClassName: 'font-medium text-gray-900',
      render: (value) => (
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-gray-900">{value}</span>
            {isCurrentWeekKey(value) ? <Badge variant="info">本周</Badge> : null}
          </div>
          <div className="text-xs text-gray-500">{formatWeekRangeLabel(value)}</div>
        </div>
      )
    },
    {
      key: 'totalDurationSeconds',
      header: '综合时长',
      cellClassName: 'font-mono text-base font-bold text-gray-800',
      render: (value) => formatComprehensiveDuration(value)
    },
    {
      key: 'sessionsCount',
      header: '打卡次数',
      render: (value) => `${value} 次`
    },
    {
      key: '_progress',
      header: '进度',
      headerClassName: 'w-56',
      render: (_, row) => {
        const progressGoalSeconds = row.weeklyGoalSeconds || weeklyGoalSeconds;
        const progress = progressGoalSeconds > 0 ? (row.totalDurationSeconds / progressGoalSeconds) * 100 : 0;

        return (
          <div className="space-y-2">
            <Progress value={progress} className="w-44" />
            <div className="text-xs text-gray-500">
              {`${Math.round(Math.max(0, Math.min(progress, 100)))}% / 目标 ${formatDuration(progressGoalSeconds)}`}
            </div>
          </div>
        );
      }
    }
  ];

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-8">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">周历史统计</h1>
      </div>
      {!loadError ? (
        <PageSection padded>
          <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold text-gray-900">周时长趋势</h2>
                <p className="mt-1 text-xs text-gray-500">基于每周综合时长绘制，包含管理员调整与卡牌娱乐时长（单位：小时）</p>
            </div>
            <div className="rounded-xl bg-blue-50 px-3 py-2 text-xs text-blue-700">
              周均时长：<span className="font-semibold">{formatComprehensiveHours(averageDurationSeconds)}</span>
            </div>
          </div>

          {loading && trendData.length === 0 ? (
            <PageState
              tone="loading"
              title="正在加载趋势图..."
              description="正在同步周统计数据。"
              className="px-0 py-10"
            />
          ) : trendData.length === 0 ? (
            <PageState
              tone="empty"
              title="暂无可绘制趋势数据"
              description="完成周打卡后，这里会展示最近周时长变化。"
              className="px-0 py-10"
            />
          ) : (
            <div className="overflow-x-auto" data-testid="weekly-duration-trend-chart">
              <LineChart
                width={Math.max(trendData.length * 140, 720)}
                height={280}
                data={trendData}
                margin={{ top: 12, right: 16, bottom: 8, left: 0 }}
              >
                <CartesianGrid stroke={CHART_COLORS.grid} vertical={false} strokeDasharray="4 4" />
                <XAxis dataKey="axisWeekLabel" axisLine={false} tickLine={false} tick={{ fill: CHART_COLORS.axisText, fontSize: 12 }} />
                <YAxis
                  axisLine={false}
                  tickLine={false}
                  width={56}
                  tick={{ fill: CHART_COLORS.axisText, fontSize: 12 }}
                  tickFormatter={(value) => formatComprehensiveHours(Number(value), 1)}
                />
                <Tooltip
                  contentStyle={CHART_TOOLTIP_CONTENT_STYLE}
                  labelStyle={CHART_TOOLTIP_LABEL_STYLE}
                  itemStyle={CHART_TOOLTIP_ITEM_STYLE}
                  formatter={(value) => formatComprehensiveHours(Number(value), 2)}
                  labelFormatter={(_, payload) => payload?.[0]?.payload?.weekKey ?? ''}
                />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Line
                  type="monotone"
                  name="综合时长"
                  dataKey="totalDurationSeconds"
                  stroke={CHART_COLORS.duration}
                  strokeWidth={2.5}
                  dot={{ r: 3.5 }}
                  activeDot={{ r: 5 }}
                />
                <Line
                  type="monotone"
                  name="周目标"
                  dataKey="goalSeconds"
                  stroke={CHART_COLORS.goal}
                  strokeWidth={2}
                  strokeDasharray="6 6"
                  dot={false}
                />
              </LineChart>
            </div>
          )}
        </PageSection>
      ) : null}

      <PageSection>
        {loadError ? (
          <PageState
            tone="error"
            title={loadError}
            action={
              <Button variant="outline" size="sm" onClick={refresh}>
                重新加载
              </Button>
            }
          />
        ) : (
          <DataTable
            columns={columns}
            data={weeklyStats.map((item) => ({ ...item, _progress: null }))}
            loading={loading}
            emptyText="暂无周历史统计"
            rowKey={(item) => item.weekKey}
          />
        )}
      </PageSection>
    </div>
  );
};
