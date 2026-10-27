import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { AlertTriangle, ChevronLeft, Flag, Trash2 } from 'lucide-react';
import { Avatar, Badge, Button, DataTable, Input, type ColumnDef } from '@lecpunch/ui';
import type { WeeklyStatItem } from '@lecpunch/shared';
import { useAuthStore } from '@/app/store/auth-store';
import {
  deleteAdminRecord,
  getMemberRecords,
  updateAdminRecordMark,
  type AttendanceRecordItem
} from '@/features/records/records.api';
import { getMemberWeeklyStats, type MemberWeeklyStatsResponse } from '@/features/stats/stats.api';
import { useAsyncData } from '@/shared/hooks/useAsyncData';
import { getApiErrorMessage } from '@/shared/lib/api-error';
import { formatDateTime, formatComprehensiveDuration, formatDuration } from '@/shared/lib/time';
import { DateRangePicker } from '@/shared/ui/DateRangePicker';
import { PageSection } from '@/shared/ui/PageSection';
import { PageState } from '@/shared/ui/PageState';
import { showToast } from '@/shared/ui/toast';

const DELETE_CONFIRMATION_TEXT = '我确认要删除这条打卡记录，且该操作不可恢复';

interface MemberRecordRow extends AttendanceRecordItem {
  _actions: null;
}

interface MemberRecordsData {
  records: AttendanceRecordItem[];
  weeklyStats: WeeklyStatItem[];
  memberInfo: MemberWeeklyStatsResponse['member'] | null;
}

const INITIAL_MEMBER_RECORDS_DATA: MemberRecordsData = {
  records: [],
  weeklyStats: [],
  memberInfo: null
};

const statusBadge = (status: string, isMarked: boolean) => {
  const statusNode =
    status === 'completed' ? (
      <Badge variant="success">正常</Badge>
    ) : status === 'invalidated' ? (
      <Badge variant="danger">超时作废</Badge>
    ) : (
      <Badge variant="info">进行中</Badge>
    );

  return (
    <div className="flex flex-wrap items-center gap-2">
      {statusNode}
      {isMarked ? <Badge variant="warning">已标记</Badge> : null}
    </div>
  );
};

export const MemberRecordsPage = () => {
  const { memberKey } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const currentUser = useAuthStore((state) => state.auth.user);
  const stateDisplayName: string | undefined = (location.state as { displayName?: string } | null)?.displayName;

  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [records, setRecords] = useState<AttendanceRecordItem[]>([]);
  const [weeklyStats, setWeeklyStats] = useState<WeeklyStatItem[]>([]);
  const [memberInfo, setMemberInfo] = useState<MemberWeeklyStatsResponse['member'] | null>(null);
  const [savingRecordId, setSavingRecordId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<AttendanceRecordItem | null>(null);
  const [deleteConfirmation, setDeleteConfirmation] = useState('');

  const isAdmin = currentUser?.role === 'admin';
  const memberName = stateDisplayName ?? memberInfo?.displayName ?? '未知成员';

  const fetchMemberRecordsData = useCallback(
    async (_signal: AbortSignal): Promise<MemberRecordsData> => {
      if (!memberKey) {
        return INITIAL_MEMBER_RECORDS_DATA;
      }

      const [recordsData, weeklyData] = await Promise.all([
        getMemberRecords(memberKey, { startDate: startDate || undefined, endDate: endDate || undefined }),
        getMemberWeeklyStats(memberKey)
      ]);

      return {
        records: recordsData,
        weeklyStats: weeklyData.items,
        memberInfo: weeklyData.member
      };
    },
    [endDate, memberKey, startDate]
  );

  const { data, loading, error, refresh } = useAsyncData(fetchMemberRecordsData, [memberKey], {
    initialData: INITIAL_MEMBER_RECORDS_DATA
  });
  const loadError = error ? getApiErrorMessage(error, '加载成员记录失败') : null;

  useEffect(() => {
    setRecords(data.records);
    setWeeklyStats(data.weeklyStats);
    setMemberInfo(data.memberInfo);
  }, [data]);

  const applyRecordPatch = (updatedRecord: AttendanceRecordItem) => {
    setRecords((current) => current.map((item) => (item.id === updatedRecord.id ? updatedRecord : item)));
  };

  const toggleRecordMark = async (record: AttendanceRecordItem) => {
    setSavingRecordId(record.id);

    try {
      const updated = await updateAdminRecordMark(record.id, !record.isMarked);
      applyRecordPatch(updated);
      showToast(record.isMarked ? '已取消记录标记' : '记录已标记');
    } catch (error) {
      showToast(getApiErrorMessage(error, '更新记录标记失败'), 'error');
    } finally {
      setSavingRecordId(null);
    }
  };

  const openDeleteDialog = (record: AttendanceRecordItem) => {
    setDeleteTarget(record);
    setDeleteConfirmation('');
  };

  const closeDeleteDialog = () => {
    if (savingRecordId) {
      return;
    }

    setDeleteTarget(null);
    setDeleteConfirmation('');
  };

  const confirmDeleteRecord = async () => {
    if (!deleteTarget || deleteConfirmation.trim() !== DELETE_CONFIRMATION_TEXT) {
      return;
    }

    setSavingRecordId(deleteTarget.id);

    try {
      await deleteAdminRecord(deleteTarget.id);
      setRecords((current) => current.filter((item) => item.id !== deleteTarget.id));
      showToast('打卡记录已删除');
      setDeleteTarget(null);
      setDeleteConfirmation('');
    } catch (error) {
      showToast(getApiErrorMessage(error, '删除打卡记录失败'), 'error');
    } finally {
      setSavingRecordId(null);
    }
  };

  const columns = useMemo<ColumnDef<MemberRecordRow>[]>(() => {
    const baseColumns: ColumnDef<MemberRecordRow>[] = [
      { key: 'weekKey', header: '周标识', cellClassName: 'font-medium text-gray-900' },
      {
        key: 'checkInAt',
        header: '上卡时间',
        cellClassName: 'font-mono',
        render: (value) => formatDateTime(value)
      },
      {
        key: 'checkOutAt',
        header: '下卡时间',
        cellClassName: 'font-mono',
        render: (value) => (value ? formatDateTime(value) : '-')
      },
      {
        key: 'durationSeconds',
        header: '有效时长',
        render: (_, row) => (
          <span
            className={`font-mono font-bold ${
              row.status === 'invalidated' ? 'text-red-500 line-through' : 'text-gray-900'
            }`}
          >
            {formatDuration(row.durationSeconds ?? 0)}
          </span>
        )
      },
      {
        key: 'status',
        header: '状态',
        render: (_, row) => statusBadge(row.status, row.isMarked)
      }
    ];

    if (!isAdmin) {
      return baseColumns;
    }

    return [
      ...baseColumns,
      {
        key: '_actions',
        header: '操作',
        headerClassName: 'text-right',
        cellClassName: 'text-right',
        render: (_, row) => {
          const isSaving = savingRecordId === row.id;
          const deleteDisabled = isSaving || row.status === 'active';

          return (
            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={isSaving}
                className={
                  row.isMarked
                    ? 'border-amber-200 bg-amber-100 text-amber-800 hover:bg-amber-200'
                    : 'text-amber-700 hover:bg-amber-50 hover:text-amber-800'
                }
                onClick={() => void toggleRecordMark(row)}
              >
                <Flag className="h-4 w-4" />
                {row.isMarked ? '取消标记' : '标记'}
              </Button>
              <Button
                variant="danger"
                size="sm"
                disabled={deleteDisabled}
                title={row.status === 'active' ? '进行中的打卡记录不能删除' : undefined}
                onClick={() => openDeleteDialog(row)}
              >
                <Trash2 className="h-4 w-4" />
                删除
              </Button>
            </div>
          );
        }
      }
    ];
  }, [isAdmin, savingRecordId]);

  const latestStat = weeklyStats[0];
  const markedCount = records.filter((record) => record.isMarked).length;
  const tableData: MemberRecordRow[] = records.map((record) => ({ ...record, _actions: null }));
  const deleteButtonDisabled = !deleteTarget || deleteConfirmation.trim() !== DELETE_CONFIRMATION_TEXT;

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-8">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div className="flex items-center gap-4">
          <Button variant="outline" size="sm" onClick={() => navigate('/members')}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <div className="flex items-center gap-3">
            <Avatar name={memberName} size="md" />
            <div>
              <h1 className="text-2xl font-bold text-gray-900">{memberName} 的打卡记录</h1>
              <p className="mt-1 text-sm text-gray-500">时长统计口径为服务端确认的有效累计时长。</p>
            </div>
          </div>
        </div>
        <DateRangePicker
          startDate={startDate}
          endDate={endDate}
          onStartChange={setStartDate}
          onEndChange={setEndDate}
          onClear={() => {
            setStartDate('');
            setEndDate('');
          }}
        />
      </div>

      {loading ? (
        <PageSection>
          <PageState tone="loading" title="正在加载成员记录..." />
        </PageSection>
      ) : loadError ? (
        <PageSection>
          <PageState
            tone="error"
            title={loadError}
            action={
              <Button variant="outline" size="sm" onClick={refresh}>
                重新加载
              </Button>
            }
          />
        </PageSection>
      ) : (
        <>
          {latestStat ? (
            <div className="flex flex-wrap gap-6 rounded-2xl border border-gray-200 bg-gray-50 p-5">
              <div className="text-sm">
                <span className="text-gray-500">成员：</span>
                <span className="font-medium text-gray-900">{memberName}</span>
              </div>
              <div className="text-sm">
                <span className="text-gray-500">最近一周：</span>
                <span className="font-medium text-gray-900">{latestStat.weekKey}</span>
              </div>
              <div className="text-sm">
                <span className="text-gray-500">有效累计时长：</span>
                <span className="font-mono text-base font-bold text-blue-600">
                  {formatComprehensiveDuration(latestStat.totalDurationSeconds)}
                </span>
              </div>
              <div className="text-sm">
                <span className="text-gray-500">打卡次数：</span>
                <span className="font-medium text-gray-900">{latestStat.sessionsCount} 次</span>
              </div>
              {isAdmin ? (
                <div className="text-sm">
                  <span className="text-gray-500">已标记：</span>
                  <span className="font-medium text-amber-700">{markedCount} 条</span>
                </div>
              ) : null}
            </div>
          ) : null}
          <PageSection>
            <DataTable
              columns={columns}
              data={tableData}
              loading={false}
              emptyText="暂无打卡记录"
              rowKey={(record) => record.id}
              rowClassName={(record) => (record.isMarked ? 'bg-amber-50/80 hover:bg-amber-100/80' : undefined)}
            />
          </PageSection>
        </>
      )}

      {deleteTarget ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/55 px-4">
          <div className="w-full max-w-lg rounded-2xl border border-red-200 bg-white p-6 shadow-2xl">
            <div className="flex items-start gap-3">
              <div className="mt-0.5 rounded-full bg-red-100 p-2 text-red-600">
                <AlertTriangle className="h-5 w-5" />
              </div>
              <div className="flex-1">
                <h2 className="text-lg font-semibold text-gray-900">确认删除打卡记录</h2>
                <p className="mt-2 text-sm leading-6 text-gray-600">
                  该操作会永久删除
                  <span className="font-semibold text-gray-900"> {memberName} </span>
                  在
                  <span className="font-semibold text-gray-900"> {formatDateTime(deleteTarget.checkInAt)} </span>
                  开始的打卡记录。此操作不可恢复，请确认你已经核对无误。
                </p>
                <p className="mt-2 text-sm text-gray-500">
                  当前记录状态：{deleteTarget.status}，记录有效时长：
                  {formatDuration(deleteTarget.durationSeconds ?? 0)}
                </p>
              </div>
            </div>

            <div className="mt-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              请输入以下确认语句后才能继续：
              <div className="mt-2 rounded-lg bg-white px-3 py-2 font-medium text-red-800">
                {DELETE_CONFIRMATION_TEXT}
              </div>
            </div>

            <div className="mt-5">
              <Input
                id="delete-record-confirmation"
                label="确认语句"
                value={deleteConfirmation}
                onChange={(event) => setDeleteConfirmation(event.target.value)}
                placeholder={DELETE_CONFIRMATION_TEXT}
                autoFocus
              />
            </div>

            <div className="mt-6 flex justify-end gap-3">
              <Button variant="outline" onClick={closeDeleteDialog} disabled={Boolean(savingRecordId)}>
                取消
              </Button>
              <Button
                variant="danger"
                loading={savingRecordId === deleteTarget.id}
                disabled={deleteButtonDisabled}
                onClick={() => void confirmDeleteRecord()}
              >
                确认删除
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
};
