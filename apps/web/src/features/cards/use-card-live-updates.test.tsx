import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CardGameActionResponse, CardGameView } from '@lecpunch/shared';
import { useCardGame } from './use-card-game';
import { CARD_LIVE_INTERVAL_MS, useCardLiveUpdates } from './use-card-live-updates';

const api = vi.hoisted(() => ({ getCardGame: vi.fn(), performCardAction: vi.fn(), getCardAction: vi.fn() }));
vi.mock('./cards.api', () => api);
const initial = (): CardGameView => ({ week: '2026-10-26', entertainmentSeconds: 0,
  points: { earned: 120, bonus: 0, spent: 0, balance: 120 }, freeRemaining: 2, giftDraws: 0,
  pity: { sinceSR: 0, sinceSSR: 0, srRemaining: 30, ssrRemaining: 70 }, collection: [], players: [],
  statuses: { acceleration: false, immuneUntil: null, lockedUntil: null, starvedUntil: null }, events: [], incomingInteractions: [] });
const incoming = (): CardGameView => ({ ...initial(), giftDraws: 2, incomingInteractions: [{ id: 'a'.repeat(64), at: '2026-10-28T04:00:00Z',
  sender: { id: 'sender', username: 'giver', displayName: '施卡者' }, card: { id: 'card-19', name: '五谷丰登', rarity: 'SSR' },
  effects: [{ target: { id: 'member', username: 'member', displayName: '成员' }, kind: 'status', outcome: 'applied', detail: '获得 2 次当周抽卡机会' }] }] });
const useLiveGame = ({ paused = false, identity = 'team:member' } = {}) => {
  const game = useCardGame(identity);
  useCardLiveUpdates(game.refreshInBackground, paused || game.busy || Boolean(game.pending || game.drawReveal || game.actionReveal), Boolean(game.view));
  return game;
};
const flush = () => act(async () => {});
const advance = (ms = CARD_LIVE_INTERVAL_MS) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });
beforeEach(() => {
  vi.useFakeTimers(); vi.clearAllMocks(); sessionStorage.clear();
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
  api.getCardGame.mockResolvedValue(initial());
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });

describe('card page background delivery', () => {
  it('receives a benefit without a manual refresh or a loading flash', async () => {
    const { result } = renderHook(() => useLiveGame()); await flush();
    expect(api.getCardGame).toHaveBeenCalledTimes(1);
    api.getCardGame.mockResolvedValue(incoming()); await advance();
    expect(result.current.view?.incomingInteractions?.[0].card.name).toBe('五谷丰登');
    expect(result.current.view?.giftDraws).toBe(2); expect(result.current.loading).toBe(false);
    expect(api.performCardAction).not.toHaveBeenCalled();
  });
  it('does not overlap a slow read and cancels it on leaving the page', async () => {
    const { unmount } = renderHook(() => useLiveGame()); await flush();
    let resolve!: (view: CardGameView) => void;
    api.getCardGame.mockImplementationOnce(() => new Promise<CardGameView>(done => { resolve = done; }));
    await advance(); const signal = api.getCardGame.mock.calls[1][0] as AbortSignal;
    await advance(30_000); expect(api.getCardGame).toHaveBeenCalledTimes(2);
    unmount(); expect(signal.aborted).toBe(true);
    await act(async () => { resolve(incoming()); }); await advance(30_000);
    expect(api.getCardGame).toHaveBeenCalledTimes(2);
  });
  it('holds incoming notices throughout a draw, then immediately catches up after the reveal', async () => {
    const { result } = renderHook(() => useLiveGame()); await flush();
    const draw: CardGameActionResponse = { state: { ...initial(), freeRemaining: 1 }, result: { action: 'draw', message: '已抽卡', drawAnimation: 'blue' } };
    api.performCardAction.mockResolvedValue(draw);
    await act(async () => { await result.current.submit({ action: 'draw' }); });
    api.getCardGame.mockResolvedValue(incoming());
    await advance(10_000);
    expect(api.getCardGame).toHaveBeenCalledTimes(1);
    expect(result.current.drawReveal).toBe(draw);
    expect(result.current.view?.incomingInteractions).toEqual([]);
    await act(async () => { result.current.finishReveal(); });
    expect(api.getCardGame).toHaveBeenCalledTimes(2);
    expect(result.current.view?.incomingInteractions?.[0].card.name).toBe('五谷丰登');
    expect(api.performCardAction).toHaveBeenCalledTimes(1);
  });
  it('preserves an existing dialog and catches up when it closes', async () => {
    const { result, rerender } = renderHook(useLiveGame, { initialProps: { paused: false } }); await flush();
    rerender({ paused: true }); api.getCardGame.mockResolvedValue(incoming()); await advance(20_000);
    expect(api.getCardGame).toHaveBeenCalledTimes(1);
    rerender({ paused: false }); await flush();
    expect(result.current.view?.incomingInteractions).toHaveLength(1);
    expect(api.getCardGame).toHaveBeenCalledTimes(2);
  });
  it('catches up immediately after a notice that was already open on the initial page load closes', async () => {
    const { result, rerender } = renderHook(useLiveGame, { initialProps: { paused: true } }); await flush();
    api.getCardGame.mockResolvedValue(incoming()); await advance(20_000);
    expect(api.getCardGame).toHaveBeenCalledTimes(1);
    rerender({ paused: false }); await flush();
    expect(result.current.view?.incomingInteractions).toHaveLength(1);
    expect(api.getCardGame).toHaveBeenCalledTimes(2);
  });
  it('aborts an in-flight background read when a dialog opens, ignoring its late result', async () => {
    const { result, rerender } = renderHook(useLiveGame, { initialProps: { paused: false } }); await flush();
    let resolve!: (view: CardGameView) => void;
    api.getCardGame.mockImplementationOnce(() => new Promise<CardGameView>(done => { resolve = done; }));
    await advance(); const signal = api.getCardGame.mock.calls[1][0] as AbortSignal;
    rerender({ paused: true }); expect(signal.aborted).toBe(true);
    await act(async () => { resolve(incoming()); });
    expect(result.current.view?.incomingInteractions).toEqual([]);
    expect(result.current.syncError).toBe('');
  });
  it('keeps current content on failure, backs off, and recovers without retrying a card action', async () => {
    const { result } = renderHook(() => useLiveGame()); await flush();
    api.getCardGame.mockRejectedValueOnce(new Error('offline'));
    await advance(); expect(result.current.syncError).toContain('当前内容已保留');
    expect(result.current.view?.points.balance).toBe(120); expect(result.current.loading).toBe(false);
    api.getCardGame.mockResolvedValue(incoming()); await advance(); expect(api.getCardGame).toHaveBeenCalledTimes(2);
    await advance(); expect(result.current.syncError).toBe('');
    expect(result.current.view?.giftDraws).toBe(2); expect(api.performCardAction).not.toHaveBeenCalled();
  });
  it('pauses in hidden or offline tabs and immediately catches up when available', async () => {
    const { result } = renderHook(() => useLiveGame()); await flush();
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    act(() => { document.dispatchEvent(new Event('visibilitychange')); }); await advance(30_000);
    expect(api.getCardGame).toHaveBeenCalledTimes(1);
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    act(() => { window.dispatchEvent(new Event('focus')); }); await advance(30_000);
    expect(api.getCardGame).toHaveBeenCalledTimes(1);
    api.getCardGame.mockResolvedValue(incoming());
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
    await act(async () => { window.dispatchEvent(new Event('online')); });
    expect(result.current.view?.incomingInteractions).toHaveLength(1);
  });
  it('does not let a pre-action background response overwrite a committed card result', async () => {
    const { result } = renderHook(() => useLiveGame()); await flush();
    let resolve!: (view: CardGameView) => void;
    api.getCardGame.mockImplementationOnce(() => new Promise<CardGameView>(done => { resolve = done; }));
    await advance(); const signal = api.getCardGame.mock.calls[1][0] as AbortSignal;
    api.performCardAction.mockResolvedValue({ state: { ...initial(), freeRemaining: 0 }, result: { action: 'use', message: '卡牌已结算' } });
    await act(async () => { await result.current.submit({ action: 'use', cardId: 'card-01' }); resolve(incoming()); });
    expect(signal.aborted).toBe(true); expect(result.current.view?.freeRemaining).toBe(0);
    expect(result.current.actionReveal).not.toBeNull(); expect(result.current.view?.incomingInteractions).toEqual([]);
  });
  it('keeps an uncertain operation pending rather than treating background reads as confirmation', async () => {
    const { result } = renderHook(() => useLiveGame()); await flush();
    api.performCardAction.mockRejectedValue(new Error('timeout'));
    await act(async () => { await result.current.submit({ action: 'draw' }); });
    const requestKey = result.current.pending?.requestKey;
    await advance(30_000);
    expect(api.getCardGame).toHaveBeenCalledTimes(1); expect(result.current.pending?.requestKey).toBe(requestKey);
    expect(result.current.error).toContain('操作结果尚未确认');
  });
});
