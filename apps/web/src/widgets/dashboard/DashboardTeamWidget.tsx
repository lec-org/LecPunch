import { formatMemberName } from '@lecpunch/shared';
import { memo } from 'react';
import { Users } from 'lucide-react';
import { Avatar, Badge, Button } from '@lecpunch/ui';
import { useDashboardContext } from '@/features/dashboard/context/DashboardContext';
import { formatComprehensiveDuration } from '@/shared/lib/time';
import { PageSection } from '@/shared/ui/PageSection';
import { PageState } from '@/shared/ui/PageState';

const DashboardTeamWidgetComponent = () => {
  const { loading, teamStats, isCurrentWeek, onOpenMember, onOpenMembers } = useDashboardContext();
  return (
    <PageSection className="flex max-h-[calc(100vh-12rem)] flex-col">
      <div className="flex items-center justify-between border-b border-gray-100 p-5">
        <div>
          <h3 className="flex items-center font-bold text-gray-800">
            <Users className="mr-2 h-5 w-5 text-blue-600" />
            同年级综合时长排行
          </h3>
        </div>
        <Badge variant={isCurrentWeek ? 'info' : 'gray'}>{isCurrentWeek ? '本周' : '固定为本周'}</Badge>
      </div>

      <div className="flex-1 overflow-y-auto p-3">
        {loading && teamStats.length === 0 ? (
          <PageState tone="loading" title="正在加载排行..." className="px-0 py-10" />
        ) : teamStats.length > 0 ? (
          <div className="space-y-2">
            {teamStats.map((member) => (
              <div
                key={member.memberKey}
                className="cursor-pointer rounded-xl border border-transparent p-3 transition-colors hover:border-gray-100 hover:bg-gray-50"
                onClick={() => onOpenMember(member)}
              >
                <div className="flex items-center">
                  <Avatar
                    name={member.displayName}
                    size="md"
                    className="mr-3"
                    avatarColor={member.avatarColor}
                    avatarEmoji={member.avatarEmoji}
                    avatarUrl={member.avatarUrl}
                    avatarBase64={member.avatarBase64}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 truncate text-sm font-bold text-gray-900">
                      <span className="truncate">{formatMemberName(member)}</span>
                      {member.adjustmentsCount > 0 ? <Badge variant="warning">含调整</Badge> : null}
                    </div>
                    <div className="mt-0.5 text-xs text-gray-500">综合时长：{formatComprehensiveDuration(member.totalDurationSeconds)}</div>
                    {member.assessmentComplete !== undefined ? <span className={`mt-1 inline-block rounded px-2 py-0.5 text-xs ${member.assessmentComplete ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
                      {member.assessmentComplete ? '✓ 本周已完成' : '○ 本周未完成'}
                    </span> : null}
                  </div>
                  <div className="flex-shrink-0 text-right">
                    <div className="rounded-md bg-gray-50 px-2 py-1 font-mono text-xs text-gray-600">
                      {member.rank ? `第 ${member.rank} 名` : `${member.sessionsCount} 次`}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <PageState tone="empty" title="暂无排行数据" className="px-0 py-10" />
        )}
      </div>

      <div className="rounded-b-2xl border-t border-gray-100 bg-gray-50 p-4">
        <Button
          variant="ghost"
          size="sm"
          className="w-full text-blue-600 hover:text-blue-800"
          onClick={onOpenMembers}
        >
          查看同年级成员
        </Button>
      </div>
    </PageSection>
  );
};

export const DashboardTeamWidget = memo(DashboardTeamWidgetComponent);

DashboardTeamWidget.displayName = 'DashboardTeamWidget';
