import { useEffect, useMemo, useState, useCallback } from 'react';
import { AlertTriangle, Search, Shield } from 'lucide-react';
import { Badge, Button, DataTable, Input, type ColumnDef } from '@lecpunch/ui';
import type { User } from '@lecpunch/shared';
import { deleteAdminMember, getAdminMembers, updateAdminMember } from '@/features/users/users.api';
import { useAuthStore } from '@/app/store/auth-store';
import { useAsyncData } from '@/shared/hooks/useAsyncData';
import { getApiErrorMessage } from '@/shared/lib/api-error';
import { PageSection } from '@/shared/ui/PageSection';
import { PageState } from '@/shared/ui/PageState';
import { showToast } from '@/shared/ui/toast';

interface AdminMembersRow extends User {
  _actions: null;
}

const DESTROY_CONFIRMATION_TEXT = '我确认已知会销毁账号，并清空数据';

export const AdminMembersPage = () => {
  const currentUser = useAuthStore((state) => state.auth.user);
  const [members, setMembers] = useState<User[]>([]);
  const [search, setSearch] = useState('');
  const [savingUserId, setSavingUserId] = useState<string | null>(null);
  const [destroyTarget, setDestroyTarget] = useState<User | null>(null);
  const [destroyConfirmation, setDestroyConfirmation] = useState('');

  const fetchMembers = useCallback(async (_signal: AbortSignal) => getAdminMembers(), []);
  const {
    data: loadedMembers,
    loading,
    error,
    refresh
  } = useAsyncData(fetchMembers, [], {
    initialData: [] as User[]
  });

  useEffect(() => {
    setMembers(loadedMembers);
  }, [loadedMembers]);

  const loadError = error ? getApiErrorMessage(error, '加载成员列表失败') : null;

  const filteredMembers = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();
    if (!normalizedSearch) {
      return members;
    }

    return members.filter((member) =>
      [member.displayName, member.username, member.name, member.studentNumber]
        .filter(Boolean)
        .some((field) => field!.toLowerCase().includes(normalizedSearch))
    );
  }, [members, search]);

  const applyMemberPatch = async (member: User, patch: { status?: User['status'] }) => {
    setSavingUserId(member.id);

    try {
      const updated = await updateAdminMember(member.id, patch);
      setMembers((current) => current.map((item) => (item.id === member.id ? updated : item)));
      showToast('成员信息已更新');
    } catch (error) {
      showToast(getApiErrorMessage(error, '更新成员失败'), 'error');
    } finally {
      setSavingUserId(null);
    }
  };

  const openDestroyDialog = (member: User) => {
    setDestroyTarget(member);
    setDestroyConfirmation('');
  };

  const closeDestroyDialog = () => {
    if (savingUserId) {
      return;
    }

    setDestroyTarget(null);
    setDestroyConfirmation('');
  };

  const confirmDestroyMember = async () => {
    if (!destroyTarget || destroyConfirmation.trim() !== DESTROY_CONFIRMATION_TEXT) {
      return;
    }

    setSavingUserId(destroyTarget.id);

    try {
      await deleteAdminMember(destroyTarget.id);
      setMembers((current) => current.filter((item) => item.id !== destroyTarget.id));
      showToast('账号已销毁，关联打卡数据已清空');
      setDestroyTarget(null);
      setDestroyConfirmation('');
    } catch (error) {
      showToast(getApiErrorMessage(error, '销毁账号失败'), 'error');
    } finally {
      setSavingUserId(null);
    }
  };

  const columns: ColumnDef<AdminMembersRow>[] = [
    {
      key: 'displayName',
      header: '成员',
      render: (_, row) => (
        <div>
          <div className="flex items-center gap-2">
            <span className="font-semibold text-gray-900">{row.displayName}</span>
            {row.id === currentUser?.id ? <Badge variant="info">本人</Badge> : null}
          </div>
          <div className="mt-1 text-xs text-gray-500">
            @{row.username}
            {row.name ? ` · ${row.name}` : ''}
            {row.studentNumber ? ` · ${row.studentNumber}` : ''}
          </div>
        </div>
      )
    },
    {
      key: 'role', header: '权限来源',
      render: (_, row) => row.id === currentUser?.id ? <Badge variant="purple">SSO 管理员</Badge> : <span className="text-xs text-gray-500">由 SSO 管理</span>
    },
    {
      key: 'status',
      header: '状态',
      render: (value) =>
        value === 'active' ? <Badge variant="success">启用中</Badge> : <Badge variant="warning">已停用</Badge>
    },
    {
      key: 'enrollYear',
      header: '年级',
      render: (value) => <span className="font-mono text-sm text-gray-700">{value}</span>
    },
    {
      key: '_actions',
      header: '操作',
      headerClassName: 'text-right',
      cellClassName: 'text-right',
      render: (_, row) => {
        const isSelf = row.id === currentUser?.id;
        const isSaving = savingUserId === row.id;

        return (
          <div className="flex justify-end gap-2">
            <Button
              variant={row.status === 'active' ? 'danger' : 'outline'}
              size="sm"
              disabled={isSelf || isSaving}
              onClick={() =>
                void applyMemberPatch(row, {
                  status: row.status === 'active' ? 'disabled' : 'active'
                })
              }
            >
              {row.status === 'active' ? '停用' : '启用'}
            </Button>
            <Button
              variant="danger"
              size="sm"
              disabled={isSelf || isSaving}
              onClick={() => openDestroyDialog(row)}
            >
              销毁账号
            </Button>
          </div>
        );
      }
    }
  ];

  const destroyButtonDisabled =
    !destroyTarget || destroyConfirmation.trim() !== DESTROY_CONFIRMATION_TEXT;

  return (
    <div className="mx-auto max-w-7xl p-8">
      <div className="mb-6 flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <div className="mb-2 flex items-center gap-2 text-sm text-blue-700">
            <Shield className="h-4 w-4" />
            管理后台
          </div>
          <h1 className="text-2xl font-bold text-gray-900">成员管理</h1>
          <p className="mt-1 text-sm text-gray-500">
            管理员权限由 SSO 决定；本页仅管理本应用启用状态和账号。启用不能替代 SSO 准入授权。
          </p>
        </div>

        <div className="relative w-full sm:w-72">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="搜索成员、用户名或学号..."
            className="w-full rounded-lg border border-gray-200 bg-white py-2 pl-9 pr-4 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
      </div>

      <PageSection>
        {loadError ? (
          <PageState
            tone="error"
            title={loadError}
            description="请确认当前账号具备管理员权限，然后重新加载成员列表。"
            action={
              <Button variant="outline" size="sm" onClick={refresh}>
                重新加载
              </Button>
            }
          />
        ) : (
          <DataTable
            columns={columns}
            data={filteredMembers.map((member) => ({ ...member, _actions: null }))}
            loading={loading}
            emptyText="暂无可管理成员"
            rowKey={(member) => member.id}
          />
        )}
      </PageSection>

      {destroyTarget ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/55 px-4">
          <div className="w-full max-w-lg rounded-2xl border border-red-200 bg-white p-6 shadow-2xl">
            <div className="flex items-start gap-3">
              <div className="mt-0.5 rounded-full bg-red-100 p-2 text-red-600">
                <AlertTriangle className="h-5 w-5" />
              </div>
              <div className="flex-1">
                <h2 className="text-lg font-semibold text-gray-900">确认销毁账号</h2>
                <p className="mt-2 text-sm leading-6 text-gray-600">
                  该操作会永久删除
                  <span className="font-semibold text-gray-900"> {destroyTarget.displayName} </span>
                  的账号，并清空其全部打卡记录。此操作不可恢复，请确认你已经提前知会当事人。
                </p>
              </div>
            </div>

            <div className="mt-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              请输入以下确认语句后才能继续：
              <div className="mt-2 rounded-lg bg-white px-3 py-2 font-medium text-red-800">
                {DESTROY_CONFIRMATION_TEXT}
              </div>
            </div>

            <div className="mt-5">
              <Input
                id="destroy-confirmation"
                label="确认语句"
                value={destroyConfirmation}
                onChange={(event) => setDestroyConfirmation(event.target.value)}
                placeholder={DESTROY_CONFIRMATION_TEXT}
                autoFocus
              />
            </div>

            <div className="mt-6 flex justify-end gap-3">
              <Button variant="outline" onClick={closeDestroyDialog} disabled={Boolean(savingUserId)}>
                取消
              </Button>
              <Button
                variant="danger"
                loading={savingUserId === destroyTarget.id}
                disabled={destroyButtonDisabled}
                onClick={() => void confirmDestroyMember()}
              >
                确认销毁
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
};
