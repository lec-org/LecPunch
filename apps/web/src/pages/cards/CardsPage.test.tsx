import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { CardGameActionResponse, CardGameView } from '@lecpunch/shared';
import { useAuthStore } from '@/app/store/auth-store';
import { createUserFixture } from '@/test/user-fixture';
import { CardsPage } from './CardsPage';

const api = vi.hoisted(() => ({ getCardGame: vi.fn(), performCardAction: vi.fn(), getCardAction: vi.fn(), getCardArt: vi.fn() }));
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
  cleanup(); vi.restoreAllMocks();
  for (const [key, descriptor] of Object.entries(originalObjectUrlDescriptors)) {
    if (descriptor) Object.defineProperty(URL, key, descriptor);
    else Reflect.deleteProperty(URL, key);
  }
});
describe('CardsPage authenticated collection', () => {
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
    api.performCardAction.mockResolvedValue(acquired()); render(<CardsPage />);
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
    confirm({ ...acquired(), result: { ...acquired().result, drawAnimation: 'blue', gainedCardIds: ['card-01'] } });
    await screen.findByRole('dialog'); expect(screen.queryByText('获得一张加速')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '跳过动画，查看结果' }));
    expect(screen.getByRole('heading', { name: '加速' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '完成，返回卡牌页面' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '刷新数据' }));
    await waitFor(() => expect(api.getCardGame).toHaveBeenCalledTimes(2));
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
