import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SubmitMessagePage } from './SubmitMessagePage';
const mocks = vi.hoisted(() => ({ submit: vi.fn() }));
vi.mock('@/features/messages/messages.api', () => ({ submitMessage: mocks.submit }));
afterEach(cleanup);
describe('SubmitMessagePage', () => {
  beforeEach(() => { vi.clearAllMocks(); });
  it('retains contents and the same request key after an unknown submission result', async () => {
    mocks.submit.mockRejectedValueOnce(new Error('timeout')).mockResolvedValueOnce({ id: 'message-1' });
    render(<SubmitMessagePage />); const user = userEvent.setup();
    await user.type(screen.getByRole('textbox', { name: '消息内容' }), '请核对我的记录');
    await user.click(screen.getByRole('button', { name: '提交消息' }));
    await screen.findByRole('alert');
    expect(screen.getByRole('textbox', { name: '消息内容' })).toHaveValue('请核对我的记录');
    await user.click(screen.getByRole('button', { name: '提交消息' }));
    await waitFor(() => expect(mocks.submit).toHaveBeenCalledTimes(2));
    expect(mocks.submit.mock.calls[0]).toEqual(mocks.submit.mock.calls[1]);
    expect(await screen.findByRole('status')).toHaveTextContent('消息已提交');
  });
});
