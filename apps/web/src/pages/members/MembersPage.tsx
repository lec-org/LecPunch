import { formatMemberName } from '@lecpunch/shared';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowDown, ArrowUp, ArrowUpDown, Eye, Layers3, Search, X } from 'lucide-react';
import { Avatar, Badge, Button, DataTable, type ColumnDef } from '@lecpunch/ui';
import type { AssessmentMemberSummaries, TeamWeeklyStatItem } from '@lecpunch/shared';
import { useAuthStore } from '@/app/store/auth-store';
import { getAssessmentMemberSummaries } from '@/features/assessment/assessment.api';
import { AssessmentHistoryDialog } from '@/features/assessment/AssessmentHistoryDialog';
import { MemberWeeklyAssessmentBadge } from '@/features/assessment/MemberWeeklyAssessmentBadge';
import { MemberCardInventoryDialog } from '@/features/cards/MemberCardInventoryDialog';
import { getTeamCurrentWeekStats } from '@/features/stats/stats.api';
import { useAsyncData } from '@/shared/hooks/useAsyncData';
import { getApiErrorMessage } from '@/shared/lib/api-error';
import { formatComprehensiveDuration, formatDuration } from '@/shared/lib/time';
import { cn } from '@/shared/lib/utils';
import { PageSection } from '@/shared/ui/PageSection';
import { PageState } from '@/shared/ui/PageState';

interface MembersTableRow extends TeamWeeklyStatItem {
  _action: null;
  _rowKey: string;
}

type SortMetric = 'duration' | 'count';
type SortDirection = 'desc' | 'asc';
type MembersScope = 'team' | 'same-grade';

interface MembersViewState {
  scope: MembersScope;
  search: string;
  selectedEnrollYear: string;
  minimumHours: string;
  maximumHours: string;
  sortMetric: SortMetric;
  sortDirection: SortDirection;
}

const SCOPE_OPTIONS: Array<{ value: MembersScope; label: string }> = [
  { value: 'team', label: '全团队' },
  { value: 'same-grade', label: '同年级' }
];

const DEFAULT_VIEW_STATE: MembersViewState = {
  scope: 'team',
  search: '',
  selectedEnrollYear: 'all',
  minimumHours: '',
  maximumHours: '',
  sortMetric: 'duration',
  sortDirection: 'desc'
};

const parseScope = (value: string | null): MembersScope | null => {
  return value === 'team' || value === 'same-grade' ? value : null;
};

const parseSort = (value: string | null): Pick<MembersViewState, 'sortMetric' | 'sortDirection'> => {
  if (!value) {
    return {
      sortMetric: DEFAULT_VIEW_STATE.sortMetric,
      sortDirection: DEFAULT_VIEW_STATE.sortDirection
    };
  }

  const [metric, direction] = value.split('-');
  const sortMetric: SortMetric = metric === 'count' ? 'count' : 'duration';
  const sortDirection: SortDirection = direction === 'asc' ? 'asc' : 'desc';

  return { sortMetric, sortDirection };
};

const buildSearchParams = (state: MembersViewState) => {
  const next = new URLSearchParams();

  if (state.scope !== DEFAULT_VIEW_STATE.scope) {
    next.set('scope', state.scope);
  }
  if (state.search.trim() !== DEFAULT_VIEW_STATE.search) {
    next.set('search', state.search);
  }
  if (state.selectedEnrollYear !== DEFAULT_VIEW_STATE.selectedEnrollYear) {
    next.set('enrollYear', state.selectedEnrollYear);
  }
  if (state.minimumHours !== DEFAULT_VIEW_STATE.minimumHours) {
    next.set('minHours', state.minimumHours);
  }
  if (state.maximumHours !== DEFAULT_VIEW_STATE.maximumHours) {
    next.set('maxHours', state.maximumHours);
  }
  if (
    state.sortMetric !== DEFAULT_VIEW_STATE.sortMetric ||
    state.sortDirection !== DEFAULT_VIEW_STATE.sortDirection
  ) {
    next.set('sort', `${state.sortMetric}-${state.sortDirection}`);
  }

  return next;
};

export const MembersPage = () => {
  const identity = useAuthStore(state => `${state.auth.user?.teamId ?? ''}:${state.auth.user?.id ?? ''}`);
  return <MembersWorkspace key={identity} />;
};

const fetchAssessmentSummaries = (signal: AbortSignal) => getAssessmentMemberSummaries(signal);

const MembersWorkspace = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const fallbackScope = parseScope((location.state as { scope?: string } | null)?.scope ?? null) ?? 'team';

  const { sortMetric, sortDirection } = useMemo(() => parseSort(searchParams.get('sort')), [searchParams]);
  const scope = parseScope(searchParams.get('scope')) ?? fallbackScope;
  const search = searchParams.get('search') ?? '';
  const selectedEnrollYear = searchParams.get('enrollYear') ?? 'all';
  const minimumHours = searchParams.get('minHours') ?? '';
  const maximumHours = searchParams.get('maxHours') ?? '';

  const viewState = useMemo<MembersViewState>(
    () => ({
      scope,
      search,
      selectedEnrollYear,
      minimumHours,
      maximumHours,
      sortMetric,
      sortDirection
    }),
    [maximumHours, minimumHours, scope, search, selectedEnrollYear, sortDirection, sortMetric]
  );

  useEffect(() => {
    const canonicalParams = buildSearchParams(viewState);
    if (canonicalParams.toString() !== searchParams.toString()) {
      setSearchParams(canonicalParams, { replace: true });
    }
  }, [searchParams, setSearchParams, viewState]);

  const updateViewState = (updates: Partial<MembersViewState>, replace = false) => {
    const nextState: MembersViewState = {
      ...viewState,
      ...updates
    };
    setSearchParams(buildSearchParams(nextState), { replace });
  };

  const fetchMembers = useCallback(
    async (_signal: AbortSignal) => getTeamCurrentWeekStats(scope === 'same-grade'),
    [scope]
  );
  const { data: members, loading, error, refresh } = useAsyncData(fetchMembers, [scope], {
    initialData: [] as TeamWeeklyStatItem[]
  });
  const loadError = error ? getApiErrorMessage(error, '加载成员统计失败') : null;
  const { data: assessment, loading: assessmentLoading, error: assessmentError, refresh: refreshAssessment } = useAsyncData(
    fetchAssessmentSummaries, [], { initialData: null as AssessmentMemberSummaries | null }
  );
  const [selectedAssessment, setSelectedAssessment] = useState<{ memberKey: string; displayName: string } | null>(null);
  const [selectedInventory, setSelectedInventory] = useState<{ memberKey: string; displayName: string } | null>(null);
  const inventoryReturnFocus = useRef<{ memberKey: string; scope: MembersScope } | null>(null);
  const closeInventory = () => {
    if (selectedInventory) inventoryReturnFocus.current = { memberKey: selectedInventory.memberKey, scope };
    setSelectedInventory(null); refresh();
  };
  useEffect(() => {
    if (loading || !inventoryReturnFocus.current) return;
    const previous = inventoryReturnFocus.current; inventoryReturnFocus.current = null;
    // Reloading replaces table rows; restore the new opener only if focus has not moved elsewhere.
    if (previous.scope === scope && document.activeElement === document.body) {
      Array.from(document.querySelectorAll<HTMLButtonElement>('[data-inventory-key]'))
        .find(button => button.dataset.inventoryKey === previous.memberKey)?.focus();
    }
  }, [loading, members, scope]);
  const failedCounts = useMemo(() => new Map(assessment?.items.map(item => [item.memberKey, item.failedWeeksCount]) ?? []), [assessment]);
  const requiredYears = assessment?.requiredEnrollYears ?? [];
  const requiresAssessment = (member: TeamWeeklyStatItem) => requiredYears.includes(member.enrollYear);

  const enrollYearOptions = useMemo(
    () => [...new Set(members.map((member) => member.enrollYear))].filter(Boolean).sort((left, right) => right - left),
    [members]
  );

  useEffect(() => {
    if (loading || selectedEnrollYear === 'all' || enrollYearOptions.length === 0) {
      return;
    }

    const hasSelectedYear = enrollYearOptions.some((year) => String(year) === selectedEnrollYear);
    if (!hasSelectedYear) {
      updateViewState({ selectedEnrollYear: 'all' }, true);
    }
  }, [enrollYearOptions, loading, selectedEnrollYear]);

  const filteredMembers = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();
    const minimumSeconds = minimumHours === '' ? null : Math.max(Number(minimumHours) || 0, 0) * 3600;
    const maximumSeconds = maximumHours === '' ? null : Math.max(Number(maximumHours) || 0, 0) * 3600;

    return [...members]
      .filter((member) => (selectedEnrollYear === 'all' ? true : String(member.enrollYear) === selectedEnrollYear))
      .filter((member) => {
        if (!normalizedSearch) {
          return true;
        }

        return [member.displayName, member.realName, member.username]
          .filter(Boolean)
          .some((value) => value!.toLowerCase().includes(normalizedSearch));
      })
      .filter((member) => (minimumSeconds === null ? true : member.totalDurationSeconds >= minimumSeconds))
      .filter((member) => (maximumSeconds === null ? true : member.totalDurationSeconds <= maximumSeconds))
      .sort((left, right) => {
        const primary =
          sortMetric === 'duration'
            ? left.totalDurationSeconds - right.totalDurationSeconds
            : left.sessionsCount - right.sessionsCount;

        if (primary !== 0) {
          return sortDirection === 'asc' ? primary : -primary;
        }

        return left.displayName.localeCompare(right.displayName);
      });
  }, [maximumHours, members, minimumHours, search, selectedEnrollYear, sortDirection, sortMetric]);

  const handleSortToggle = (metric: SortMetric) => {
    if (sortMetric === metric) {
      updateViewState({
        sortDirection: sortDirection === 'desc' ? 'asc' : 'desc'
      });
      return;
    }

    updateViewState({
      sortMetric: metric,
      sortDirection: 'desc'
    });
  };

  const resetFilters = () => {
    updateViewState({
      search: '',
      selectedEnrollYear: 'all',
      minimumHours: '',
      maximumHours: ''
    });
  };

  const hasActiveFilters =
    search.trim() !== '' || selectedEnrollYear !== 'all' || minimumHours !== '' || maximumHours !== '';

  const renderSortIcon = (metric: SortMetric) => {
    if (sortMetric !== metric) {
      return <ArrowUpDown className="h-3.5 w-3.5 text-gray-400" />;
    }

    return sortDirection === 'desc' ? (
      <ArrowDown className="h-3.5 w-3.5 text-blue-600" />
    ) : (
      <ArrowUp className="h-3.5 w-3.5 text-blue-600" />
    );
  };

  const renderSortHeader = (label: string, metric: SortMetric) => (
    <button
      type="button"
      onClick={() => handleSortToggle(metric)}
      className="inline-flex items-center gap-1 text-xs font-semibold normal-case tracking-normal text-gray-600 transition hover:text-gray-900"
      aria-label={`sort-${metric}`}
    >
      <span>{label}</span>
      {renderSortIcon(metric)}
    </button>
  );

  const columns: ColumnDef<MembersTableRow>[] = [
    {
      key: 'displayName',
      header: <span className="normal-case tracking-normal">排名 / 成员</span>,
      headerClassName: 'normal-case tracking-normal',
      render: (_, row, index) => (
        <div className="flex items-center gap-4">
          <div
            className={`flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold ${
              index < 3 ? 'bg-blue-50 text-blue-700' : 'bg-gray-100 text-gray-500'
            }`}
          >
            {index + 1}
          </div>
          <Avatar
            name={row.displayName}
            size="sm"
            avatarColor={row.avatarColor}
            avatarEmoji={row.avatarEmoji}
            avatarUrl={row.avatarUrl}
            avatarBase64={row.avatarBase64}
          />
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold text-gray-900">
              {formatMemberName(row)}
            </div>
          </div>
        </div>
      )
    },
    {
      key: 'enrollYear',
      header: <span className="normal-case tracking-normal">成员年级</span>,
      headerClassName: 'whitespace-nowrap normal-case tracking-normal',
      render: (value) => <span className="whitespace-nowrap font-medium text-gray-700">{value ? `${value} 级` : '-'}</span>
    },
    {
      key: 'totalDurationSeconds',
      header: renderSortHeader('综合时长', 'duration'),
      headerClassName: 'normal-case tracking-normal',
      cellClassName: 'whitespace-nowrap font-mono text-base font-bold text-gray-800',
      render: (value) => formatComprehensiveDuration(value)
    },
    {
      key: 'sessionsCount',
      header: renderSortHeader('打卡次数', 'count'),
      headerClassName: 'normal-case tracking-normal',
      cellClassName: 'whitespace-nowrap',
      render: (value) => `${value} 次`
    },
    {
      key: '_cards',
      header: <span className="whitespace-nowrap normal-case tracking-normal">持有卡片</span>,
      cellClassName: 'whitespace-nowrap',
      render: (_, row) => row.cardCount === undefined ? <span className="text-xs text-gray-500">暂不可用</span> :
        <button type="button" data-inventory-key={row.memberKey} aria-label={`查看${formatMemberName(row)}的卡牌库存，共${row.cardCount}张`} onClick={() => setSelectedInventory({ memberKey: row.memberKey, displayName: formatMemberName(row) })}
          className="inline-flex min-h-10 items-center gap-1.5 rounded-lg px-2 py-2 text-sm text-blue-700 hover:bg-blue-50 focus-visible:outline-2 focus-visible:outline-blue-600"><Layers3 size={15} aria-hidden="true" />{row.cardCount} 张</button>
    },
    {
      key: '_weeklyAssessment',
      header: <span className="whitespace-nowrap normal-case tracking-normal">本周考核</span>,
      render: (_, row) => !assessment ? <span className="text-xs text-gray-500">{assessmentError ? '考核范围不可用' : '读取中…'}</span> : requiresAssessment(row) ? <MemberWeeklyAssessmentBadge member={row} /> : <span aria-label="非应考年级" className="text-gray-400">—</span>
    },
    {
      key: '_assessmentHistory',
      header: <span className="whitespace-nowrap normal-case tracking-normal">历史考核</span>,
      cellClassName: 'whitespace-nowrap',
      render: (_, row) => {
        if (!assessment) return <span className="text-xs text-gray-500">{assessmentError ? '历史状态不可用' : '读取中…'}</span>;
        if (!requiresAssessment(row)) return <span aria-label="非应考年级" className="text-gray-400">—</span>;
        if (assessmentLoading) return <span className="text-xs text-gray-500">读取中…</span>;
        if (assessmentError) return <span className="text-xs text-gray-500">历史状态不可用</span>;
        if (!assessment?.enabled) return <span className="text-xs text-gray-500">尚未启用</span>;
        const count = failedCounts.get(row.memberKey);
        if (count === undefined) return <span className="text-xs text-gray-500">历史状态待核实</span>;
        return <button type="button" className={`rounded-lg px-2 py-1 text-xs underline underline-offset-4 focus-visible:outline focus-visible:outline-2 ${count > 0 ? 'text-red-700 hover:bg-red-50' : 'text-gray-500 hover:bg-gray-100'}`}
          onClick={() => setSelectedAssessment({ memberKey: row.memberKey, displayName: formatMemberName(row) })}>
          打卡考核未通过 {count} 次
        </button>;
      }
    },
    {
      key: '_action',
      header: <span className="normal-case tracking-normal" />,
      headerClassName: 'text-right normal-case tracking-normal',
      cellClassName: 'whitespace-nowrap text-right',
      render: (_, row) => (
        <Button
          variant="ghost"
          size="sm"
          className="whitespace-nowrap text-blue-600 hover:bg-blue-50 hover:text-blue-800"
          onClick={(event) => {
            event.stopPropagation();
            navigate(`/members/${row.memberKey}/records`, {
              state: { displayName: row.displayName }
            });
          }}
        >
          <Eye className="h-4 w-4" />
          查看流水
        </Button>
      )
    }
  ];

  const tableData: MembersTableRow[] = filteredMembers.map((member, index) => ({
    ...member,
    _action: null,
    _rowKey: `${member.memberKey}-${index}`
  }));

  const scopeLabel = scope === 'same-grade' ? '同年级' : '全团队';

  return (
    <div className="mx-auto max-w-7xl p-8">
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">团队成员</h1>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="info">仅本周</Badge>
          <Badge variant="gray">{scopeLabel}</Badge>
          <Badge variant="gray">{filteredMembers.length} 人</Badge>
        </div>
      </div>

      {loadError ? (
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
        <div className="space-y-6">
          <PageSection padded>
            <div className="space-y-5">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold text-gray-900">筛选</h2>
                <Button type="button" variant="outline" size="sm" onClick={resetFilters} disabled={!hasActiveFilters}>
                  <X className="h-4 w-4" />
                  清空筛选
                </Button>
              </div>

              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
                <div className="block xl:col-span-1">
                  <span className="mb-2 block text-xs font-semibold uppercase tracking-wide text-gray-500">
                    查看范围
                  </span>
                  <div className="flex rounded-xl bg-gray-100 p-1">
                    {SCOPE_OPTIONS.map((option) => (
                      <button
                        key={option.value}
                        type="button"
                        aria-label={`scope-${option.value}`}
                        aria-pressed={scope === option.value}
                        onClick={() => updateViewState({ scope: option.value })}
                        className={cn(
                          'flex-1 rounded-lg px-3 py-2 text-sm font-medium transition',
                          scope === option.value
                            ? 'bg-white text-gray-900 shadow-sm'
                            : 'text-gray-500 hover:text-gray-700'
                        )}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                </div>

                <label className="block xl:col-span-1">
                  <span className="mb-2 block text-xs font-semibold uppercase tracking-wide text-gray-500">
                    成员搜索
                  </span>
                  <div className="relative">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                    <input
                      type="text"
                      aria-label="member-search"
                      placeholder="按成员名搜索"
                      value={search}
                      onChange={(event) => updateViewState({ search: event.target.value })}
                      className="h-11 w-full rounded-xl border border-gray-200 bg-white py-2 pl-9 pr-4 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                </label>

                <label className="block xl:col-span-1">
                  <span className="mb-2 block text-xs font-semibold uppercase tracking-wide text-gray-500">
                    年级筛选
                  </span>
                  <select
                    aria-label="grade-filter"
                    value={selectedEnrollYear}
                    onChange={(event) => updateViewState({ selectedEnrollYear: event.target.value })}
                    className="h-11 w-full rounded-xl border border-gray-200 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="all">全部年级</option>
                    {enrollYearOptions.map((year) => (
                      <option key={year} value={String(year)}>
                        {year} 级
                      </option>
                    ))}
                  </select>
                </label>

                <label className="block xl:col-span-1">
                  <span className="mb-2 block text-xs font-semibold uppercase tracking-wide text-gray-500">
                    最小时长(小时)
                  </span>
                  <input
                    type="number"
                    min={0}
                    step={0.5}
                    aria-label="minimum-hours-filter"
                    value={minimumHours}
                    onChange={(event) => updateViewState({ minimumHours: event.target.value })}
                    className="h-11 w-full rounded-xl border border-gray-200 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </label>

                <label className="block xl:col-span-1">
                  <span className="mb-2 block text-xs font-semibold uppercase tracking-wide text-gray-500">
                    最长时长(小时)
                  </span>
                  <input
                    type="number"
                    min={0}
                    step={0.5}
                    aria-label="maximum-hours-filter"
                    value={maximumHours}
                    onChange={(event) => updateViewState({ maximumHours: event.target.value })}
                    className="h-11 w-full rounded-xl border border-gray-200 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </label>
              </div>
            </div>
          </PageSection>

          <PageSection>
            <div className="flex items-center justify-between border-b border-gray-100 px-6 py-4">
              <h2 className="text-lg font-semibold text-gray-900">成员统计</h2>
              <Badge variant="gray">{scopeLabel}</Badge>
            </div>

            <div className="border-b border-gray-100 px-6 py-3 text-xs leading-6 text-gray-500">
              <p>当前应考年级：{requiredYears.length ? requiredYears.map(year => `${year} 级`).join('、') : '读取中／待核实'}（最新两届）。团队实际加入新一届成员后才切换，不按日期自动换届。</p>
              <p>应考成员按综合时长显示灰／绿状态；高年级不显示考核标签，也不新增未通过记录。点击未通过次数可查看对应周日。</p>
              {assessment?.enabled && <p>从 {assessment.startWeek} 起算；首次登记当周免考，停用周豁免。周日结束后保留五小时结算窗口，过去周不追罚。</p>}
              {Boolean(assessmentError) && <div role="alert" className="mt-2 text-red-700">历史考核读取失败，未通过次数暂不可用。<button type="button" className="ml-2 underline underline-offset-4" onClick={refreshAssessment}>重试历史考核</button></div>}
            </div>

            <DataTable
              columns={columns}
              data={tableData}
              loading={loading}
              emptyText="当前范围和筛选下暂无成员数据"
              rowKey={(member) => member._rowKey}
            />
          </PageSection>
        </div>
      )}
      {selectedAssessment && <AssessmentHistoryDialog key={selectedAssessment.memberKey} memberKey={selectedAssessment.memberKey} displayName={selectedAssessment.displayName} onClose={() => setSelectedAssessment(null)} />}
      {selectedInventory && <MemberCardInventoryDialog key={selectedInventory.memberKey} memberKey={selectedInventory.memberKey} displayName={selectedInventory.displayName} onClose={closeInventory} />}
    </div>
  );
};
