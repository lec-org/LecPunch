import { memo } from 'react';
import { AlertTriangle, History, Play, Square } from 'lucide-react';
import { ATTENDANCE_MAX_SECONDS } from '@lecpunch/shared';
import { Progress } from '@lecpunch/ui';
import { useDashboardContext } from '@/features/dashboard/context/DashboardContext';
import { formatDuration, formatComprehensiveDuration } from '@/shared/lib/time';

const DashboardAttendanceWidgetComponent = () => {
  const {
    loading,
    weekLabel,
    isCurrentWeek,
    isCheckedIn,
    currentDuration,
    selectedWeekDuration,
    selectedWeekRecordedDuration,
    selectedWeekManualAdjustment,
    selectedWeekEntertainment = 0,
    selectedWeekAdjustmentsCount,
    selectedWeekSessionsCount,
    weeklyGoalSeconds,
    submitting,
    isWarning,
    isNearLimit,
    onAttendanceAction
  } = useDashboardContext();

  const spotlightSeconds = isCurrentWeek ? currentDuration : selectedWeekDuration;
  const completedSeconds = selectedWeekDuration;
  const progressPercent = Math.min((currentDuration / ATTENDANCE_MAX_SECONDS) * 100, 100);
  const goalPercent = weeklyGoalSeconds > 0 ? Math.max(0, Math.min((completedSeconds / weeklyGoalSeconds) * 100, 100)) : 0;
  const goalHours = weeklyGoalSeconds / 3600;
  const remainingSeconds = Math.max(weeklyGoalSeconds - completedSeconds, 0);
  const remainingHours = Math.floor(remainingSeconds / 3600);
  const remainingMinutes = Math.floor((remainingSeconds % 3600) / 60);
  const reachedGoal = weeklyGoalSeconds > 0 && completedSeconds >= weeklyGoalSeconds;

  const title = loading
    ? '正在加载...'
    : isCurrentWeek
      ? isCheckedIn
        ? '正在记录打卡时长...'
        : '当前未打卡，开始今天的努力吧！'
      : `${weekLabel}累计有效时长`;

  return (
    <div className="relative flex flex-col items-center justify-between gap-8 overflow-hidden rounded-2xl border border-gray-200 bg-white p-8 shadow-sm md:flex-row">
      {isCurrentWeek && isCheckedIn ? (
        <div className={`absolute left-0 top-0 h-full w-1 ${isWarning ? 'bg-red-500' : 'bg-blue-500'}`} />
      ) : null}

      <div className="flex-1 text-center md:text-left">
        <h3 className="mb-2 text-sm font-medium text-gray-500">{title}</h3>
        <div
          className={`mb-4 font-mono text-6xl font-bold tracking-tight ${
            !loading && !isCurrentWeek && selectedWeekDuration > 0
              ? 'text-gray-900'
              : isCheckedIn
                ? 'text-gray-900'
                : 'text-gray-300'
          }`}
        >
          {formatComprehensiveDuration(spotlightSeconds)}
        </div>

        <div className="mb-4 flex flex-wrap gap-3 text-sm">
          <div className="rounded-xl border border-slate-100 bg-slate-50 px-4 py-3">
            <p className="text-xs text-gray-500">{weekLabel}综合时长</p>
            <p className="mt-1 font-mono text-lg font-semibold text-gray-900">
              {formatComprehensiveDuration(selectedWeekDuration)}
            </p>
          </div>
          <div className="rounded-xl border border-slate-100 bg-slate-50 px-4 py-3">
            <p className="text-xs text-gray-500">{weekLabel}打卡次数</p>
            <p className="mt-1 text-lg font-semibold text-gray-900">{selectedWeekSessionsCount} 次</p>
          </div>
        </div>

        <p className="mb-3 text-xs text-gray-500">
          综合时长包含考勤与卡牌娱乐时长（{formatComprehensiveDuration(selectedWeekEntertainment)}）。
          进行中的打卡在有效签退后计入考核。
        </p>

        {selectedWeekAdjustmentsCount > 0 ? (
          <p className="mb-4 text-xs text-slate-500">
            原始打卡 {formatDuration(selectedWeekRecordedDuration)}，管理员调整
            <span className={selectedWeekManualAdjustment > 0 ? 'ml-1 font-semibold text-emerald-700' : 'ml-1 font-semibold text-rose-700'}>
              {selectedWeekManualAdjustment >= 0 ? '+' : '-'}{formatDuration(Math.abs(selectedWeekManualAdjustment))}
            </span>
            （{selectedWeekAdjustmentsCount} 条）。积分仍按原始打卡计算。
          </p>
        ) : null}

        {weeklyGoalSeconds > 0 ? (
          <div className="mb-4 max-w-md rounded-xl border border-slate-100 bg-slate-50 p-3">
            <div className="mb-1.5 flex items-center justify-between text-xs">
              <span className="font-medium text-gray-500">周目标 {goalHours}h</span>
              <span className={reachedGoal ? 'font-bold text-green-600' : 'font-medium text-blue-600'}>
                {reachedGoal
                  ? '✓ 已达标'
                  : `还差 ${remainingHours > 0 ? `${remainingHours}h ` : ''}${remainingMinutes}m`}
              </span>
            </div>
            <Progress
              value={goalPercent}
              variant={reachedGoal ? 'default' : goalPercent >= 80 ? 'warning' : 'default'}
            />
            <p className="mt-1.5 text-xs text-gray-400">
              已完成 {formatComprehensiveDuration(completedSeconds)} / {goalHours}h
            </p>
          </div>
        ) : null}

        {isCurrentWeek && isCheckedIn ? (
          <div className="max-w-md">
            <div className="mb-1.5 flex justify-between text-xs">
              <span className="text-gray-500">单次有效时长（上限 5 小时）</span>
              <span className={isWarning ? 'font-bold text-red-600' : 'font-medium text-blue-600'}>
                {Math.floor(progressPercent)}%
              </span>
            </div>
            <Progress
              value={progressPercent}
              variant={isNearLimit ? 'danger' : isWarning ? 'warning' : 'default'}
            />
            {isWarning ? (
              <p className="mt-2 flex items-center rounded-md bg-red-50 p-2 text-sm text-red-600">
                <AlertTriangle className="mr-2 h-4 w-4 flex-shrink-0" />
                {isNearLimit ? '还剩 15 分钟将达到 5 小时上限，请及时下卡。' : '接近 5 小时上限，请注意打卡时长'}
              </p>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="flex-shrink-0">
        {isCurrentWeek ? (
          <button
            onClick={onAttendanceAction}
            disabled={loading || submitting}
            className={`flex h-40 w-40 flex-col items-center justify-center rounded-full text-white shadow-xl transition-all duration-300 hover:scale-105 active:scale-95 disabled:cursor-not-allowed disabled:opacity-60 ${
              isCheckedIn
                ? 'animate-pulse-slow bg-gradient-to-br from-red-500 to-rose-600 shadow-red-200/50'
                : 'bg-gradient-to-br from-blue-600 to-indigo-600 shadow-blue-200/50 hover:shadow-blue-300/50'
            }`}
          >
            {isCheckedIn ? (
              <Square className="mb-2 h-10 w-10 fill-current" />
            ) : (
              <Play className="mb-2 ml-1 h-10 w-10 fill-current" />
            )}
            <span className="text-xl font-bold tracking-widest">{submitting ? '...' : isCheckedIn ? '下卡' : '上卡'}</span>
          </button>
        ) : (
          <div className="flex h-40 w-40 flex-col items-center justify-center rounded-full border-4 border-dashed border-gray-200 bg-gray-50 text-gray-400">
            <History className="mb-2 h-8 w-8 opacity-50" />
            <span className="px-4 text-center text-sm font-medium">
              历史周
              <br />
              不可打卡
            </span>
          </div>
        )}
      </div>
    </div>
  );
};

export const DashboardAttendanceWidget = memo(DashboardAttendanceWidgetComponent);

DashboardAttendanceWidget.displayName = 'DashboardAttendanceWidget';
