import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { CardGameActionResponse, CardGameView } from '@lecpunch/shared';
import { useAuthStore } from '@/app/store/auth-store';
import { createUserFixture } from '@/test/user-fixture';
import { CardsPage } from './CardsPage';

const api = vi.hoisted(() => ({ getCardGame: vi.fn(), performCardAction: vi.fn(), getCardAction: vi.fn(), getCardArt: vi.fn(), acknowledgeCardGifts: vi.fn(), acknowledgeCardDefenses: vi.fn(), acknowledgeCardInteractions: vi.fn() }));
vi.mock('@/features/cards/cards.api', () => api);
const originalObjectUrlDescriptors = Object.fromEntries(['createObjectURL', 'revokeObjectURL'].map(key => [key, Object.getOwnPropertyDescriptor(URL, key)]));
const makeView = (): CardGameView => ({
  week: '2026-10-26', entertainmentSeconds: 0, points: { earned: 120, bonus: 0, spent: 0, balance: 120 }, freeRemaining: 2, giftDraws: 0,
  pity: { sinceSR: 0, sinceSSR: 0, srRemaining: 30, ssrRemaining: 70 },
  collection: Array.from({ length: 21 }, (_, i) => ({ id: `card-${String(i + 1).padStart(2, '0')}`, rarity: i < 4 ? 'N' : i < 11 ? 'R' : i < 18 ? 'SR' : 'SSR', unlocked: false, quantity: 0 })),
  players: [{ id: 'member-1', username: 'member', displayName: 'Member', enrollYear: 2024 }, { id: 'member-2', username: 'other', displayName: '其他成员', enrollYear: 2024 }],
  statuses: { acceleration: false, immuneUntil: null, lockedUntil: null, starvedUntil: null }, events: []
});
const acquired = (): CardGameActionResponse => {
  const state = makeView(); state.freeRemaining = 1;
  state.collection[0] = { id: 'card-01', rarity: 'N', unlocked: true, quantity: 1, name: '加速', type: '个人增益', effect: '下一次有效签退获得娱乐加成。', detail: '不改原始考勤。', stat: '+15%', usable: true, targetMode: 'none' };
  return { result: { message: '获得一张加速', gainedCardId: 'card-01' }, state };
};
beforeEach(() => {
  vi.clearAllMocks(); sessionStorage.clear();
  useAuthStore.setState({ auth: { token: 'token', user: createUserFixture() } });
  api.getCardGame.mockResolvedValue(makeView()); api.getCardArt.mockResolvedValue(new Blob(['test'], { type: 'image/png' }));
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, writable: true, value: vi.fn(() => 'blob:card-art') });
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, writable: true, value: vi.fn() });
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
  HTMLDialogElement.prototype.showModal = vi.fn(function(this: HTMLDialogElement) { this.setAttribute('open', ''); });
  HTMLDialogElement.prototype.close = vi.fn(function(this: HTMLDialogElement) { this.removeAttribute('open'); });
});
afterEach(() => {
  cleanup(); vi.useRealTimers(); vi.restoreAllMocks();
  for (const [key, descriptor] of Object.entries(originalObjectUrlDescriptors)) {
    if (descriptor) Object.defineProperty(URL, key, descriptor);
    else Reflect.deleteProperty(URL, key);
  }
});
describe('CardsPage authenticated collection', () => {
  const interactionView = (): CardGameView => ({ ...makeView(), incomingInteractions: [{ id: 'f'.repeat(64), at: '2026-10-28T04:00:00Z',
    randomlySelected: true,
    sender: { id: 'member-2', username: 'other', displayName: '施卡成员' }, card: { id: 'card-14', name: '雷电', rarity: 'SR' }, effects: [
      { target: { id: 'member-1', username: 'member', displayName: 'Member' }, kind: 'judgement', outcome: 'applied', detail: '雷电判定命中（逐人独立 50% 判定）' },
      { target: { id: 'member-1', username: 'member', displayName: 'Member' }, kind: 'time', outcome: 'blocked', deltaSeconds: 0 }
    ] }] });
  it('shows explicit lightning judgement and blocked results without replaying the attack', async () => {
    const state = interactionView(); api.getCardGame.mockResolvedValueOnce(state).mockResolvedValue({ ...state, incomingInteractions: [] });
    api.acknowledgeCardInteractions.mockResolvedValue({ acknowledged: 1 }); render(<CardsPage />);
    const dialog = await screen.findByRole('dialog', { name: '你的卡牌互动结果' });
    expect(within(dialog).getByText('施卡成员')).toBeInTheDocument();
    expect(within(dialog).getByText('被系统随机判定到的').tagName).toBe('STRONG');
    expect(within(dialog).getByText(/雷电判定命中/)).toBeInTheDocument();
    expect(within(dialog).getByText(/防御或免疫抵消/)).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: '知道了，确认互动结果' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(api.acknowledgeCardInteractions).toHaveBeenCalledWith(['f'.repeat(64)]);
    expect(api.performCardAction).not.toHaveBeenCalled();
  });
  it('names the user who prohibited card acquisition without calling a selected target random', async () => {
    const state = interactionView();
    const notice = state.incomingInteractions![0];
    delete notice.randomlySelected;
    notice.card = { id: 'card-16', name: '兵粮寸断', rarity: 'SR' };
    notice.effects = [{ target: { id: 'member-1', username: 'member', displayName: 'Member' }, kind: 'status', outcome: 'applied', detail: '暂停获得新卡 3 小时' }];
    api.getCardGame.mockResolvedValue(state); render(<CardsPage />);
    const dialog = await screen.findByRole('dialog', { name: '你的卡牌互动结果' });
    expect(within(dialog).getByText('施卡成员')).toBeInTheDocument();
    expect(within(dialog).getByText('兵粮寸断')).toBeInTheDocument();
    expect(within(dialog).getByText('暂停获得新卡 3 小时')).toBeInTheDocument();
    expect(within(dialog).queryByText('被系统随机判定到的')).not.toBeInTheDocument();
    expect(api.performCardAction).not.toHaveBeenCalled();
  });
  it('shows the original card user for a linked effect without a random-target claim', async () => {
    const state = interactionView(), notice = state.incomingInteractions![0];
    delete notice.randomlySelected;
    notice.sender = { id: 'linker', username: 'original.linker', displayName: '连环施卡者' };
    notice.card = { id: 'card-13', name: '铁索连环', rarity: 'SR' };
    notice.effects = [{ target: { id: 'member-1', username: 'member', displayName: 'Member' }, kind: 'time', outcome: 'applied', deltaSeconds: -1800,
      source: { user: notice.sender, card: notice.card } }];
    api.getCardGame.mockResolvedValue(state); render(<CardsPage />);
    const dialog = await screen.findByRole('dialog', { name: '你的卡牌互动结果' });
    expect(within(dialog).getByText(/连带效果来自/)).toHaveTextContent('连环施卡者（original.linker）使用的 铁索连环');
    expect(within(dialog).queryByText('被系统随机判定到的')).not.toBeInTheDocument();
  });

  it('keeps an unread interaction on close and retries a failed acknowledgement using the same identifiers', async () => {
    api.getCardGame.mockResolvedValue(interactionView());
    const first = render(<CardsPage />);
    let dialog = await screen.findByRole('dialog', { name: '你的卡牌互动结果' });
    await userEvent.click(within(dialog).getByRole('button', { name: '稍后再看' }));
    expect(api.acknowledgeCardInteractions).not.toHaveBeenCalled(); first.unmount();
    api.acknowledgeCardInteractions.mockRejectedValueOnce(new Error('timeout')).mockResolvedValueOnce({ acknowledged: 1 }); render(<CardsPage />);
    dialog = await screen.findByRole('dialog', { name: '你的卡牌互动结果' });
    await userEvent.click(within(dialog).getByRole('button', { name: '知道了，确认互动结果' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(/已读状态尚未确认/);
    await userEvent.click(within(dialog).getByRole('button', { name: '知道了，确认互动结果' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(api.acknowledgeCardInteractions.mock.calls).toEqual([[['f'.repeat(64)]], [['f'.repeat(64)]]]);
  });
  it('offers both required grades for the scoped cards and only the own grade for gifting', async () => {
    const state = makeView();state.requiredEnrollYears = [2025,2024];
    state.players.push({ id: 'new-cohort', username: 'new', displayName: '新届成员', enrollYear: 2025 }, { id: 'senior', username: 'old', displayName: '高年级成员', enrollYear: 2023 });
    state.collection[9] = { id: 'card-10', rarity: 'R', unlocked: true, quantity: 1, name: '乐不思蜀', usable: true, targetMode: 'other', targetScope: 'assessment' };
    api.getCardGame.mockResolvedValue(state); render(<CardsPage />);
    await userEvent.click(await screen.findByRole('button', { name: '使用乐不思蜀' }));
    let select = screen.getByRole('combobox', { name: '选择目标' });
    expect(within(select).getByRole('option', { name: /新届成员/ })).toBeInTheDocument();
    expect(within(select).queryByRole('option', { name: /高年级成员/ })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '赠送卡片' }));
    select = screen.getByRole('combobox', { name: '赠送给' });
    expect(within(select).queryByRole('option', { name: /新届成员/ })).not.toBeInTheDocument();
    expect(within(select).getByRole('option', { name: /其他成员/ })).toBeInTheDocument();
  });
  const defendedView = (): CardGameView => ({ ...makeView(), incomingDefenses: [{ id: 'd'.repeat(64), at: '2026-10-28T04:00:00Z', randomlySelected: true, events: [{
    attacker: { id: 'member-2', username: 'other', displayName: '攻击成员' },
    attackCard: { id: 'card-02', name: '减时长', rarity: 'N' }, defenseCard: { id: 'card-04', name: '仁王盾', rarity: 'N' }, outcome: 'blocked'
  }] }] });
  it('shows the attacker and automatically consumed defense card, then acknowledges without another use', async () => {
    const state = defendedView();
    api.getCardGame.mockResolvedValueOnce(state).mockResolvedValue({ ...state, incomingDefenses: [] });
    api.acknowledgeCardDefenses.mockResolvedValue({ acknowledged: 1 }); render(<CardsPage />);
    const dialog = await screen.findByRole('dialog', { name: '你的卡片已自动防御' });
    expect(within(dialog).getByText('攻击成员')).toBeInTheDocument();
    expect(within(dialog).getByText('被系统随机判定到的').tagName).toBe('STRONG');
    expect(within(dialog).getByText('减时长')).toBeInTheDocument();
    expect(within(dialog).getByText('仁王盾')).toBeInTheDocument();
    expect(within(dialog).getByText(/已自动使用并消耗 1 张/)).toHaveTextContent('成功防住该次攻击');
    await userEvent.click(within(dialog).getByRole('button', { name: '知道了，确认防御记录' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(api.acknowledgeCardDefenses).toHaveBeenCalledWith(['d'.repeat(64)]);
    expect(api.performCardAction).not.toHaveBeenCalled();
  });
  it('retains a failed defense acknowledgement and retries the original identifiers', async () => {
    api.getCardGame.mockResolvedValue(defendedView());
    api.acknowledgeCardDefenses.mockRejectedValueOnce(new Error('timeout')).mockResolvedValueOnce({ acknowledged: 1 }); render(<CardsPage />);
    const dialog = await screen.findByRole('dialog', { name: '你的卡片已自动防御' });
    await userEvent.click(within(dialog).getByRole('button', { name: '知道了，确认防御记录' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(/已读状态尚未确认/);
    await userEvent.click(within(dialog).getByRole('button', { name: '知道了，确认防御记录' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(api.acknowledgeCardDefenses.mock.calls).toEqual([[['d'.repeat(64)]], [['d'.repeat(64)]]]);
    expect(api.performCardAction).not.toHaveBeenCalled();
  });
  it('queues defense before gifts, and closing leaves the defense unread for the next visit', async () => {
    const state = defendedView();
    state.incomingGifts = [{ id: 'e'.repeat(64), at: '2026-10-28T04:00:00Z', sender: { id: 'member-2', username: 'other', displayName: '赠送成员' }, card: { id: 'card-01', name: '加速', rarity: 'N' } }];
    api.getCardGame.mockResolvedValue(state);
    const first = render(<CardsPage />);
    const dialog = await screen.findByRole('dialog', { name: '你的卡片已自动防御' });
    expect(screen.queryByRole('dialog', { name: '你收到了赠送的卡片' })).not.toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: '稍后再看' }));
    expect(await screen.findByRole('dialog', { name: '你收到了赠送的卡片' })).toBeInTheDocument();
    expect(api.acknowledgeCardDefenses).not.toHaveBeenCalled();
    first.unmount(); render(<CardsPage />);
    expect(await screen.findByRole('dialog', { name: '你的卡片已自动防御' })).toBeInTheDocument();
  });
  it('shows the actual replacement card when using the mystery card', async () => {
    const state = makeView();
    state.collection[2] = { id: 'card-03', rarity: 'N', unlocked: true, quantity: 1, name: '?', type: '随机换卡', effect: '获得一张卡。', detail: '不参与保底。', stat: '随机', usable: true, targetMode: 'none' };
    api.getCardGame.mockResolvedValue(state);
    api.performCardAction.mockResolvedValue({ ...acquired(), result: { action: 'use', message: '获得一张卡牌', gainedCardId: 'card-01', actionCard: { id: 'card-03', name: '?', rarity: 'N' } } });
    render(<CardsPage />);
    await userEvent.click(await screen.findByRole('button', { name: '使用?' }));
    await userEvent.click(screen.getByRole('button', { name: '确认使用一张' }));
    const result = await screen.findByRole('dialog', { name: '用卡结果' });
    expect(within(result).getByRole('region', { name: '随机换卡获得' })).toHaveTextContent('加速');
    expect(within(result).getByText('已加入库存，并永久解锁图鉴。')).toBeInTheDocument();
  });
  it('exposes a direct use button and displays the selected and reflected targets after confirmation', async () => {
    api.getCardGame.mockResolvedValue(acquired().state);
    api.performCardAction.mockResolvedValue({ ...acquired(), result: { message: '用卡已确认', action: 'use',
      actionCard: { id: 'card-01', name: '加速', rarity: 'N' }, effects: [{
        target: { id: 'member-2', username: 'other', displayName: '随机目标' }, actualTarget: { id: 'member-1', username: 'member', displayName: '实际目标' },
        outcome: 'reflected', kind: 'time', deltaSeconds: -1800
      }] } });
    render(<CardsPage />); await userEvent.click(await screen.findByRole('button', { name: '使用加速' }));
    await userEvent.click(screen.getByRole('button', { name: '确认使用一张' }));
    const result = await screen.findByRole('dialog', { name: '用卡结果' });
    expect(within(result).getByText('随机目标')).toBeInTheDocument();
    expect(within(result).getByText(/被反弹，实际作用于 实际目标/)).toBeInTheDocument();
    expect(within(result).getByText('扣除 00:30:00 综合时长')).toBeInTheDocument();
    await userEvent.click(within(result).getByRole('button', { name: '知道了' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(api.performCardAction).toHaveBeenCalledOnce();
    await userEvent.click(screen.getByRole('button', { name: '赠送加速' }));
    expect(screen.queryByText('用卡已确认')).not.toBeInTheDocument();
  });
  it('opens gifting directly from the inventory button', async () => {
    api.getCardGame.mockResolvedValue(acquired().state); render(<CardsPage />);
    await userEvent.click(await screen.findByRole('button', { name: '赠送加速' }));
    expect(screen.getByRole('combobox', { name: '赠送给' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '确认赠送一张' })).toBeDisabled();
    await userEvent.selectOptions(screen.getByRole('combobox', { name: '赠送给' }), 'member-2');
    expect(screen.getByRole('button', { name: '确认赠送一张' })).toBeEnabled();
  });
  it('shows received cards with their sender on entry and acknowledges without granting a second copy', async () => {
    const state = acquired().state;
    state.incomingGifts = [{ id: 'a'.repeat(64), at: '2026-10-28T03:00:00Z', sender: { id: 'member-2', username: 'other', displayName: '赠送者' }, card: { id: 'card-01', name: '加速', rarity: 'N' } }];
    api.getCardGame.mockResolvedValueOnce(state).mockResolvedValue({ ...state, incomingGifts: [] });
    api.acknowledgeCardGifts.mockResolvedValue({ acknowledged: 1 });
    render(<CardsPage />);
    const dialog = await screen.findByRole('dialog', { name: '你收到了赠送的卡片' });
    expect(within(dialog).getByText('来自 赠送者（other）')).toBeInTheDocument();
    expect(within(dialog).getByText(/无需再次领取/)).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: '知道了，查看卡牌' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(api.acknowledgeCardGifts).toHaveBeenCalledWith(['a'.repeat(64)]);
    expect(screen.getByText('持有 1')).toBeInTheDocument();
    expect(api.performCardAction).not.toHaveBeenCalled();
  });
  it('retains the gift popup on acknowledgement failure and retries the same identifiers', async () => {
    const state = acquired().state;
    state.incomingGifts = [{ id: 'b'.repeat(64), at: '2026-10-28T03:00:00Z', sender: { id: 'member-2', username: 'other', displayName: '赠送者' }, card: { id: 'card-01', name: '加速', rarity: 'N' } }];
    api.getCardGame.mockResolvedValue(state);
    api.acknowledgeCardGifts.mockRejectedValueOnce(new Error('timeout')).mockResolvedValueOnce({ acknowledged: 1 });
    render(<CardsPage />);
    const dialog = await screen.findByRole('dialog', { name: '你收到了赠送的卡片' });
    await userEvent.click(within(dialog).getByRole('button', { name: '知道了，查看卡牌' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(/已读状态尚未确认/);
    expect(dialog).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: '知道了，查看卡牌' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(api.acknowledgeCardGifts.mock.calls).toEqual([[['b'.repeat(64)]], [['b'.repeat(64)]]]);
    expect(api.performCardAction).not.toHaveBeenCalled();
  });
  it('closing a gift popup leaves it unread for the next visit', async () => {
    const state = acquired().state;
    state.incomingGifts = [{ id: 'c'.repeat(64), at: '2026-10-28T03:00:00Z', sender: { id: 'member-2', username: 'other', displayName: '赠送者' }, card: { id: 'card-01', name: '加速', rarity: 'N' } }];
    api.getCardGame.mockResolvedValue(state);
    const first = render(<CardsPage />);
    await userEvent.click(await screen.findByRole('button', { name: '稍后再看' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(api.acknowledgeCardGifts).not.toHaveBeenCalled();
    first.unmount(); render(<CardsPage />);
    expect(await screen.findByRole('dialog', { name: '你收到了赠送的卡片' })).toBeInTheDocument();
  });
  it('shows the full ten-draw cost and disables a batch when the balance cannot cover it', async () => {
    render(<CardsPage />);
    expect(await screen.findByRole('button', { name: '十连抽 · 480 积分' })).toBeDisabled();
    expect(screen.getByText('本次十连：免费 2 次 ＋ 赠送 0 次 ＋ 480 积分；不足十抽不扣费。')).toBeInTheDocument();
    expect(api.performCardAction).not.toHaveBeenCalled();
  });

  it('includes free and gift draws in a batch and preserves count on a timed-out retry', async () => {
    const view = makeView(); view.giftDraws = 6;
    api.getCardGame.mockResolvedValue(view);
    const saved = acquired(); saved.result = { message: '十连抽成功', drawCount: 10, drawAnimation: 'purple', gainedCardIds: Array(10).fill('card-01') };
    api.performCardAction.mockRejectedValueOnce(new Error('timeout')).mockResolvedValueOnce(saved);
    render(<CardsPage />);
    await userEvent.click(await screen.findByRole('button', { name: '十连抽 · 120 积分' }));
    await screen.findByRole('region', { name: '待确认操作' });
    const original = api.performCardAction.mock.calls[0][0];
    expect(original).toMatchObject({ action: 'draw', count: 10 });
    expect(screen.getByRole('button', { name: /十连抽/ })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: '使用原请求重试' }));
    await screen.findByRole('dialog');
    expect(api.performCardAction.mock.calls[1][0]).toEqual(original);
    await userEvent.click(screen.getByRole('button', { name: '跳过展示，直接看十连结果' }));
    expect(screen.getByText(/10 次抽取 · 共获得 10 张卡牌/)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '加速 ×10' })).toBeInTheDocument();
  });

  it('restores and verifies a pending ten-draw request without issuing another draw', async () => {
    const pending = { action: 'draw', count: 10, requestKey: '00000000-0000-4000-8000-000000000002' };
    sessionStorage.setItem('lecpunch-card-pending:team-1:member-1', JSON.stringify(pending));
    const saved = acquired(); saved.result = { message: '十连抽成功', drawCount: 10, drawAnimation: 'purple', gainedCardIds: Array(10).fill('card-01') };
    api.getCardAction.mockResolvedValue(saved); render(<CardsPage />);
    await userEvent.click(await screen.findByRole('button', { name: '核实操作结果' }));
    await screen.findByRole('dialog');
    expect(api.getCardAction).toHaveBeenCalledWith(pending.requestKey);
    expect(api.performCardAction).not.toHaveBeenCalled();
  });

  it('shows current pity as n / m and keeps probabilities inside the rules dialog', async () => {
    const state = makeView(); state.pity = { sinceSR: 4, sinceSSR: 14, srRemaining: 26, ssrRemaining: 56 };
    api.getCardGame.mockResolvedValue(state); render(<CardsPage />);
    expect(await screen.findByLabelText('SR 或以上保底进度')).toHaveTextContent('4 / 30');
    expect(screen.getByLabelText('SSR 保底进度')).toHaveTextContent('14 / 70');
    expect(screen.queryByText('90%')).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: '综合时长排行与考核记录' })).not.toBeInTheDocument();
    const opener = screen.getByRole('button', { name: '查看抽卡规则' }); await userEvent.click(opener);
    const dialog = screen.getByRole('dialog', { name: '抽卡规则与概率' });
    expect(within(dialog).getByText('90%')).toBeInTheDocument();
    expect(within(dialog).getByText('2%')).toBeInTheDocument();
    expect(within(dialog).getByText('7.7%')).toBeInTheDocument();
    expect(within(dialog).getByText('0.3%')).toBeInTheDocument();
    expect(within(dialog).getByText(/30% 概率触发捕获明光/)).toBeInTheDocument();
    fireEvent(dialog, new Event('cancel', { bubbles: true, cancelable: true }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument(); expect(opener).toHaveFocus();
    expect(api.performCardAction).not.toHaveBeenCalled();
  });
  it('opens card details and actions as a modal, then restores focus on Escape', async () => {
    api.getCardGame.mockResolvedValue(acquired().state);
    render(<CardsPage />);
    const opener = await screen.findByRole('button', { name: '查看加速卡面详情' });
    await userEvent.click(opener);
    const dialog = await screen.findByRole('dialog', { name: '加速' });
    expect(within(dialog).getByRole('button', { name: '确认使用一张' })).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: '赠送卡片' })).toBeInTheDocument();
    fireEvent(dialog, new Event('cancel', { bubbles: true, cancelable: true }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
    expect(api.performCardAction).not.toHaveBeenCalled();
  });
  it('keeps all undiscovered cards gray and does not request their art or expose names', async () => {
    api.getCardGame.mockResolvedValue({ ...makeView(), entertainmentSeconds: -1800 });
    render(<CardsPage />);
    expect(await screen.findByText('已发现 0 / 21 种。抽到或收到赠卡后永久揭晓。')).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: '我的卡牌图鉴' })).getAllByText('未知卡牌')).toHaveLength(21);
    expect(screen.getByRole('button', { name: 'N 0/4' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'SSR 0/3' })).toBeInTheDocument();
    expect(screen.queryAllByRole('img')).toHaveLength(0);
    expect(api.getCardArt).not.toHaveBeenCalled();
    expect(screen.queryByText('加速')).not.toBeInTheDocument();
    expect(screen.getByText('−00:30:00')).toBeInTheDocument();
  });
  it('shows comprehensive time and quota rather than a separate positive card-income balance', async () => {
    api.getCardGame.mockResolvedValue({ ...makeView(), entertainmentSeconds: -1800,
      points: { rule: 'comprehensive-v1', comprehensiveSeconds: 5400, earned: 90, bonus: 0, spent: 60, balance: 30 } });
    render(<CardsPage />);
    expect(await screen.findByText('综合时长额度 90 − 已使用 60')).toBeInTheDocument();
    expect(screen.getByText('01:30:00')).toBeInTheDocument();
    expect(screen.getByText('本周综合时长')).toBeInTheDocument();
    expect(screen.queryByText(/卡牌新增收益/)).not.toBeInTheDocument();
  });
  it('reveals only the card actually returned by a committed draw', async () => {
    api.performCardAction.mockImplementation(async () => {
      const saved = acquired(); api.getCardGame.mockResolvedValue(saved.state); return saved;
    }); render(<CardsPage />);
    await userEvent.click(await screen.findByRole('button', { name: /免费抽卡/ }));
    expect(await screen.findByRole('status')).toHaveTextContent('获得一张加速');
    expect(await screen.findByRole('img', { name: '加速卡面' })).toHaveAttribute('src', 'blob:card-art');
    expect(within(screen.getByRole('region', { name: '我的卡牌图鉴' })).getAllByText('未知卡牌')).toHaveLength(20);
    expect(api.getCardArt).toHaveBeenCalledWith('card-01', expect.any(AbortSignal));
    expect(api.getCardArt).toHaveBeenCalledTimes(1);
    expect(api.performCardAction).toHaveBeenCalledTimes(1);
  });
  it('retains a timed-out request and retries with the same key and exact payload', async () => {
    api.performCardAction.mockRejectedValueOnce(new Error('timeout')).mockResolvedValueOnce(acquired());
    render(<CardsPage />); await userEvent.click(await screen.findByRole('button', { name: /免费抽卡/ }));
    expect(await screen.findByRole('region', { name: '待确认操作' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /免费抽卡/ })).toBeDisabled();
    const first = api.performCardAction.mock.calls[0][0];
    expect(JSON.parse(sessionStorage.getItem('lecpunch-card-pending:team-1:member-1')!)).toEqual(first);
    await userEvent.click(screen.getByRole('button', { name: '使用原请求重试' }));
    await screen.findByText('获得一张加速');
    expect(api.performCardAction.mock.calls[1][0]).toEqual(first);
    expect(sessionStorage.getItem('lecpunch-card-pending:team-1:member-1')).toBeNull();
  });
  it('restores a pending operation after remount and verifies it without another mutation', async () => {
    const pending = { action: 'draw', requestKey: '00000000-0000-4000-8000-000000000001' };
    sessionStorage.setItem('lecpunch-card-pending:team-1:member-1', JSON.stringify(pending));
    api.getCardAction.mockResolvedValue({ ...acquired(), result: { ...acquired().result, drawAnimation: 'purple', gainedCardIds: ['card-01'] } }); render(<CardsPage />);
    expect(await screen.findByRole('button', { name: /免费抽卡/ })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: '核实操作结果' }));
    await screen.findByRole('dialog');
    expect(document.querySelector('video')).toHaveAttribute('src', '/media/card-draw/purple.mp4');
    await userEvent.click(screen.getByRole('button', { name: '跳过动画，查看结果' }));
    await userEvent.click(screen.getByRole('button', { name: '完成，返回卡牌页面' }));
    await screen.findByText('获得一张加速');
    expect(api.getCardAction).toHaveBeenCalledWith(pending.requestKey);
    expect(api.performCardAction).not.toHaveBeenCalled();
  });
  it('waits for a confirmed draw before showing the selected video and does not replay on refresh', async () => {
    let confirm!: (value: CardGameActionResponse) => void;
    api.performCardAction.mockImplementation(() => new Promise(resolve => { confirm = resolve; }));
    render(<CardsPage />); await userEvent.click(await screen.findByRole('button', { name: /免费抽卡/ }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    const saved = { ...acquired(), result: { ...acquired().result, drawAnimation: 'blue' as const, gainedCardIds: ['card-01'] } };
    api.getCardGame.mockResolvedValue(saved.state); confirm(saved);
    await screen.findByRole('dialog'); expect(screen.queryByText('获得一张加速')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '跳过动画，查看结果' }));
    expect(screen.getByRole('heading', { name: '加速' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '完成，返回卡牌页面' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await waitFor(() => expect(api.getCardGame).toHaveBeenCalledTimes(2));
    await userEvent.click(screen.getByRole('button', { name: '刷新数据' }));
    await waitFor(() => expect(api.getCardGame).toHaveBeenCalledTimes(3));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument(); expect(api.performCardAction).toHaveBeenCalledOnce();
  });
  it('filters gift recipients to other members and submits the selected opaque card id', async () => {
    api.getCardGame.mockResolvedValue(acquired().state);
    api.performCardAction.mockResolvedValue({ ...acquired(), result: { message: '赠送完成' } });
    render(<CardsPage />); await userEvent.click(await screen.findByRole('button', { name: '查看加速' }));
    await userEvent.click(screen.getByRole('button', { name: '赠送卡片' }));
    const select = screen.getByRole('combobox', { name: '赠送给' });
    expect(within(select).queryByRole('option', { name: /Member/ })).not.toBeInTheDocument();
    await userEvent.selectOptions(select, 'member-2');
    await userEvent.click(screen.getByRole('button', { name: '确认赠送一张' }));
    await waitFor(() => expect(api.performCardAction).toHaveBeenCalledWith(expect.objectContaining({ action: 'gift', cardId: 'card-01', targetId: 'member-2' })));
  });
  it.each(['benefit', 'attack'])('automatically opens a new %s notice while staying on the page', async kind => {
    vi.useFakeTimers();
    await act(async () => { render(<CardsPage />); });
    expect(screen.getByRole('button', { name: /免费抽卡/ })).toBeInTheDocument();
    const state = interactionView(), notice = state.incomingInteractions![0];
    if (kind === 'benefit') {
      delete notice.randomlySelected;
      notice.card = { id: 'card-19', name: '五谷丰登', rarity: 'SSR' };
      notice.effects = [{ target: { id: 'member-1', username: 'member', displayName: 'Member' }, kind: 'status', outcome: 'applied', detail: '获得 2 次当周抽卡机会' }];
    }
    api.getCardGame.mockResolvedValue(state);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    const dialog = screen.getByRole('dialog', { name: '你的卡牌互动结果' });
    expect(within(dialog).getByText('施卡成员')).toBeInTheDocument();
    expect(within(dialog).getByText(kind === 'benefit' ? '获得 2 次当周抽卡机会' : /雷电判定命中/)).toBeInTheDocument();
    expect(api.getCardGame).toHaveBeenCalledTimes(2);
    expect(api.performCardAction).not.toHaveBeenCalled();
  });
  it.each([1, 10] as const)('holds an incoming notice through a %s-card draw and its results', async count => {
    const saved = acquired(); saved.result.drawAnimation = 'blue';
    if (count === 10) {
      const start = makeView(); start.giftDraws = 10; api.getCardGame.mockResolvedValue(start);
      saved.result.drawCount = 10; saved.result.gainedCardIds = Array(10).fill('card-01'); saved.state.collection[0].quantity = 10;
    }
    api.performCardAction.mockResolvedValue(saved);
    render(<CardsPage />); await userEvent.click(await screen.findByRole('button', { name: count === 10 ? /十连抽/ : /免费抽卡/ }));
    const animation = await screen.findByRole('dialog', { name: '抽卡揭晓' });
    const state = interactionView(); state.collection = saved.state.collection; state.freeRemaining = 1;
    api.getCardGame.mockResolvedValue(state); vi.useFakeTimers();
    await act(async () => { await vi.advanceTimersByTimeAsync(10000); });
    expect(screen.getByRole('dialog', { name: '抽卡揭晓' })).toBe(animation);
    expect(screen.queryByRole('dialog', { name: '你的卡牌互动结果' })).not.toBeInTheDocument();
    expect(api.getCardGame).toHaveBeenCalledTimes(1);
    // Skipping the video still holds notifications until the result view closes.
    fireEvent.click(within(animation).getByRole('button', { name: count === 10 ? '跳过展示，直接看十连结果' : '跳过动画，查看结果' }));
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(api.getCardGame).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog', { name: '你的卡牌互动结果' })).not.toBeInTheDocument();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '完成，返回卡牌页面' })); });
    expect(screen.getByRole('dialog', { name: '你的卡牌互动结果' })).toBeInTheDocument();
    expect(api.getCardGame).toHaveBeenCalledTimes(2); expect(api.performCardAction).toHaveBeenCalledTimes(1);
  });

  it.each(['interaction', 'defense', 'gift'] as const)('does not redisplay a deferred %s when a new notice arrives', async kind => {
    const state = makeView(), oldId = '1'.repeat(64), newId = '2'.repeat(64);
    if (kind === 'interaction') {
      state.incomingInteractions = [{ ...interactionView().incomingInteractions![0], id: oldId,
        sender: { id: 'old', username: 'old.sender', displayName: '之前的施卡者' } }];
    } else if (kind === 'defense') {
      const notice = structuredClone(defendedView().incomingDefenses![0]); notice.id = oldId;
      notice.events[0].attacker = { id: 'old', username: 'old.sender', displayName: '之前的施卡者' };
      state.incomingDefenses = [notice];
    } else state.incomingGifts = [{ id: oldId, at: '2026-10-28T04:00:00Z',
      sender: { id: 'old', username: 'old.sender', displayName: '之前的施卡者' }, card: { id: 'card-01', name: '加速', rarity: 'N' } }];
    api.getCardGame.mockResolvedValue(state); const rendered = render(<CardsPage />);
    await userEvent.click(await screen.findByRole('button', { name: '稍后再看' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    const next = structuredClone(state);
    if (kind === 'interaction') next.incomingInteractions!.push({ ...next.incomingInteractions![0], id: newId,
      sender: { id: 'new', username: 'new.sender', displayName: '新施卡者' } });
    else if (kind === 'defense') {
      const notice = structuredClone(next.incomingDefenses![0]); notice.id = newId;
      notice.events[0].attacker = { id: 'new', username: 'new.sender', displayName: '新施卡者' };
      next.incomingDefenses!.push(notice);
    } else next.incomingGifts!.push({ ...next.incomingGifts![0], id: newId,
      sender: { id: 'new', username: 'new.sender', displayName: '新施卡者' } });
    api.getCardGame.mockResolvedValue(next);
    fireEvent(window, new Event('focus'));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('新施卡者', { exact: false })).toBeInTheDocument();
    expect(within(dialog).queryByText('之前的施卡者', { exact: false })).not.toBeInTheDocument();
    const ack = kind === 'interaction' ? api.acknowledgeCardInteractions : kind === 'defense' ? api.acknowledgeCardDefenses : api.acknowledgeCardGifts;
    ack.mockResolvedValue({ acknowledged: 1 }); api.getCardGame.mockResolvedValue(state);
    await userEvent.click(within(dialog).getByRole('button', { name: kind === 'interaction' ? '知道了，确认互动结果' : kind === 'defense' ? '知道了，确认防御记录' : '知道了，查看卡牌' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(ack).toHaveBeenCalledWith([newId]);
    // Deferring is local to this visit; it does not silently acknowledge the old notice.
    rendered.unmount(); render(<CardsPage />);
    expect(within(await screen.findByRole('dialog')).getByText('之前的施卡者', { exact: false })).toBeInTheDocument();
  });

  it('ignores a previous-account background notification arriving after an account switch', async () => {
    vi.useFakeTimers();
    const rendered = await act(async () => render(<CardsPage />));
    let resolve!: (view: CardGameView) => void;
    api.getCardGame.mockImplementationOnce(() => new Promise<CardGameView>(done => { resolve = done; }));
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    const signal = api.getCardGame.mock.calls[1][0] as AbortSignal;
    const newAccount = interactionView(); newAccount.incomingInteractions![0].sender.displayName = '新账号通知';
    api.getCardGame.mockResolvedValue(newAccount);
    await act(async () => {
      useAuthStore.getState().setAuth({ token: 'other', user: createUserFixture({ id: 'another-member' }) });
      rendered.rerender(<CardsPage />);
    });
    expect(signal.aborted).toBe(true);
    await act(async () => { resolve(interactionView()); });
    const dialog = screen.getByRole('dialog', { name: '你的卡牌互动结果' });
    expect(within(dialog).getByText('新账号通知')).toBeInTheDocument();
    expect(within(dialog).queryByText('施卡成员')).not.toBeInTheDocument();
    expect(api.performCardAction).not.toHaveBeenCalled();
  });
  it('does not let an old acknowledgement close the new account notification', async () => {
    api.getCardGame.mockResolvedValue(interactionView()); const rendered = render(<CardsPage />);
    let resolve!: (result: { acknowledged: number }) => void;
    api.acknowledgeCardInteractions.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: '知道了，确认互动结果' }));
    const newAccount = interactionView(); newAccount.incomingInteractions![0].sender.displayName = '新账号通知';
    api.getCardGame.mockResolvedValue(newAccount);
    await act(async () => {
      useAuthStore.getState().setAuth({ token: 'other', user: createUserFixture({ id: 'another-member' }) });
      rendered.rerender(<CardsPage />);
    });
    await act(async () => { resolve({ acknowledged: 1 }); });
    expect(within(screen.getByRole('dialog')).getByText('新账号通知')).toBeInTheDocument();
    expect(api.getCardGame).toHaveBeenCalledTimes(2);
    expect(api.acknowledgeCardInteractions).toHaveBeenCalledTimes(1);
  });

  it('does not carry previous-account collection or image URLs into another login', async () => {
    api.getCardGame.mockResolvedValueOnce(acquired().state).mockResolvedValue(makeView());
    const rendered = render(<CardsPage />); await screen.findByRole('img', { name: '加速卡面' });
    useAuthStore.setState({ auth: { token: 'other', user: createUserFixture({ id: 'another-member' }) } });
    rendered.rerender(<CardsPage />);
    await screen.findByText('已发现 0 / 21 种。抽到或收到赠卡后永久揭晓。');
    expect(screen.queryByAltText('加速卡面')).not.toBeInTheDocument();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:card-art');
  });
});
