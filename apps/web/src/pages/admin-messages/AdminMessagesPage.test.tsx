import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { MemberMessage } from '@/features/messages/messages.api';
import { AdminMessagesPage } from './AdminMessagesPage';

const mocks = vi.hoisted(() => ({ list: vi.fn(), process: vi.fn() }));
vi.mock('@/features/messages/messages.api', () => ({
  getAdminMessages: mocks.list, processMessage: mocks.process, downloadMessageImage: vi.fn()
}));
const message: MemberMessage = {
  id: 'message-1', description: '测试消息', createdAt: '2026-10-17T10:00:00Z', imagesExpireAt: null,
  reporter: { userId: 'member-1', username: 'fixture', displayName: '测试成员' }, images: [],
  processingStatus: 'open', processingNote: '旧备注', processedBy: null, processedByDisplayName: null, processedAt: null
};
const latest: MemberMessage = { ...message, processingStatus: 'processed', processingNote: '其他管理员的新备注', processedAt: '2026-10-17T11:00:00Z' };
const refreshWith = async (next: MemberMessage) => {
  mocks.list.mockResolvedValueOnce({ items: [next], total: 1 });
  await userEvent.click(screen.getByRole('button', { name: '刷新' }));
  await waitFor(() => expect(screen.queryByText('正在加载…')).not.toBeInTheDocument());
};

describe('AdminMessagesPage', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.list.mockResolvedValue({ items: [message], total: 1 });
  });
  afterEach(cleanup);

  it('uses the refreshed server note when no local draft was edited', async () => {
    render(<AdminMessagesPage />);
    await screen.findByDisplayValue('旧备注');
    await refreshWith(latest);
    expect(screen.getByRole('textbox', { name: '处理备注' })).toHaveValue(latest.processingNote);
    mocks.process.mockResolvedValue({ ...latest, processingStatus: 'open' });
    await userEvent.click(screen.getByRole('button', { name: '重新打开' }));
    await waitFor(() => expect(mocks.process).toHaveBeenCalledExactlyOnceWith(message.id, 'open', latest.processingNote));
  });

  it('preserves a conflicting draft and requires loading the latest note before submission', async () => {
    render(<AdminMessagesPage />);
    const input = await screen.findByRole('textbox', { name: '处理备注' });
    await userEvent.clear(input);
    await userEvent.type(input, '本地草稿');
    await refreshWith(latest);
    expect(input).toHaveValue('本地草稿');
    expect(screen.getByRole('alert')).toHaveTextContent('服务器备注已更新');
    const reopen = screen.getByRole('button', { name: '重新打开' });
    expect(reopen).toBeDisabled();
    await userEvent.click(reopen);
    expect(mocks.process).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: '载入最新备注' }));
    expect(input).toHaveValue(latest.processingNote);
    expect(reopen).toBeEnabled();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('retains an edited draft when refresh returns the same server note', async () => {
    render(<AdminMessagesPage />);
    const input = await screen.findByRole('textbox', { name: '处理备注' });
    await userEvent.clear(input);
    await userEvent.type(input, '本地草稿');
    await refreshWith(message);
    expect(input).toHaveValue('本地草稿');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    mocks.process.mockResolvedValue({ ...message, processingStatus: 'processed', processingNote: '本地草稿' });
    await userEvent.click(screen.getByRole('button', { name: '标记处理完成' }));
    await waitFor(() => expect(mocks.process).toHaveBeenCalledWith(message.id, 'processed', '本地草稿'));
    await screen.findByRole('button', { name: '重新打开' });
    await refreshWith(latest);
    expect(input).toHaveValue(latest.processingNote);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('keeps the draft available if saving fails', async () => {
    render(<AdminMessagesPage />);
    const input = await screen.findByRole('textbox', { name: '处理备注' });
    await userEvent.type(input, '追加内容');
    mocks.process.mockRejectedValue(new Error('network unavailable'));
    await userEvent.click(screen.getByRole('button', { name: '标记处理完成' }));
    await screen.findByRole('alert');
    expect(input).toHaveValue('旧备注追加内容');
    expect(screen.getByRole('button', { name: '标记处理完成' })).toBeEnabled();
  });
});
