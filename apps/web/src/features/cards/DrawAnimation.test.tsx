import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { CardGameActionResponse } from '@lecpunch/shared';
import { DrawAnimation } from './DrawAnimation';
vi.mock('./CardArt', () => ({ CardArt: ({ name }: { name: string }) => <span>{name}图像</span> }));
const response = (duplicate = false): CardGameActionResponse => ({
  result: { message: '本次获得双份SSR奖励', gainedCardIds: ['card-19', duplicate ? 'card-19' : 'card-20'], drawAnimation: 'radiance', ssrPity: true },
  state: { week: '2026-10-26', entertainmentSeconds: 0, points: { earned: 0, bonus: 0, spent: 0, balance: 0 }, freeRemaining: 1, giftDraws: 0, pity: { sinceSR: 0, sinceSSR: 0, srRemaining: 30, ssrRemaining: 70 }, players: [], statuses: { acceleration: false, immuneUntil: null, lockedUntil: null, starvedUntil: null }, events: [], collection: [
    { id: 'card-19', rarity: 'SSR', quantity: 1, unlocked: true, name: '五谷丰登' },
    { id: 'card-20', rarity: 'SSR', quantity: 1, unlocked: true, name: '无懈可击' }
  ] }
});
beforeEach(() => {
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
  HTMLDialogElement.prototype.showModal = vi.fn(function(this: HTMLDialogElement) { this.setAttribute('open', ''); });
  HTMLDialogElement.prototype.close = vi.fn(function(this: HTMLDialogElement) { this.removeAttribute('open'); });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
describe('DrawAnimation saved-result playback', () => {
  it('reveals ten cards one at a time in order and ends with the ten-draw summary', async () => {
    const saved = response(); saved.result = { ...saved.result, drawCount: 10, radianceCount: 1,
      gainedCardIds: ['card-19', ...Array(8).fill('card-01'), 'card-20'] };
    saved.state.collection.push({ id: 'card-01', name: '加速', rarity: 'N', quantity: 8, unlocked: true });
    const complete = vi.fn(); const rendered = render(<DrawAnimation response={saved} onComplete={complete} />);
    fireEvent.ended(rendered.container.querySelector('video')!);
    await screen.findByRole('heading', { name: '第 1 / 10 张' });
    expect(screen.getByRole('heading', { name: '五谷丰登' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: '无懈可击' })).not.toBeInTheDocument();
    expect(screen.getAllByRole('article')).toHaveLength(1);
    for (let step = 2; step <= 10; step++) {
      await userEvent.click(screen.getByRole('button', { name: '下一张' }));
      expect(await screen.findByRole('heading', { name: `第 ${step} / 10 张` })).toBeInTheDocument();
      expect(screen.getAllByRole('article')).toHaveLength(1);
    }
    expect(screen.getByRole('heading', { name: '无懈可击' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '查看十连结果' }));
    expect(screen.getByRole('heading', { name: '十连结果' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '加速 ×8' })).toBeInTheDocument();
    expect(screen.getByText(/10 次抽取 · 共获得 10 张卡牌/)).toBeInTheDocument();
    expect(complete).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: '完成，返回卡牌页面' }));
    expect(complete).toHaveBeenCalledOnce();
  });
  it.each(['video', 'individual'])('can skip from %s directly to all ten saved rewards', async phase => {
    const saved = response(); saved.result = { ...saved.result, drawCount: 10, radianceCount: 1,
      gainedCardIds: [...Array(9).fill('card-19'), 'card-20'] };
    const rendered = render(<DrawAnimation response={saved} onComplete={vi.fn()} />);
    if (phase === 'individual') {
      fireEvent.ended(rendered.container.querySelector('video')!);
      await screen.findByRole('heading', { name: '第 1 / 10 张' });
      await userEvent.click(screen.getByRole('button', { name: '下一张' }));
    }
    await userEvent.click(screen.getByRole('button', { name: '跳过展示，直接看十连结果' }));
    expect(screen.getByRole('heading', { name: '十连结果' })).toBeInTheDocument();
    expect(screen.getByText(/10 次抽取 · 共获得 10 张卡牌/)).toBeInTheDocument();
    expect(screen.getByText(/十连至少获得两张 SSR，总数仍为 10 张/)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '五谷丰登 ×9' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '下一张' })).not.toBeInTheDocument();
  });
  it('plays the server-selected video without showing reward names, then reveals both SSR rewards on ended', async () => {
    const complete = vi.fn(); const rendered = render(<DrawAnimation response={response()} onComplete={complete} />);
    const video = rendered.container.querySelector('video')!;
    expect(video).toHaveAttribute('src', '/media/card-draw/radiance.mp4');
    expect(video).toHaveAttribute('playsinline'); expect(video.muted).toBe(true);
    expect(screen.queryByText('五谷丰登')).not.toBeInTheDocument(); expect(screen.queryByText('本次获得双份SSR奖励')).not.toBeInTheDocument();
    fireEvent.ended(video);
    expect(rendered.container.querySelector('.draw-white-wash')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: '五谷丰登' })).not.toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: '五谷丰登' })).toBeInTheDocument();
    expect(rendered.container.querySelectorAll('.draw-reward-enter')).toHaveLength(2);
    expect(screen.getByRole('heading', { name: '无懈可击' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '完成，返回卡牌页面' })); expect(complete).toHaveBeenCalledOnce();
  });
  it('lets the user skip and merges duplicate rewards into a visible quantity', async () => {
    const complete = vi.fn(); render(<DrawAnimation response={response(true)} onComplete={complete} />);
    await userEvent.click(screen.getByRole('button', { name: '跳过动画，查看结果' }));
    expect(document.querySelector('.draw-white-wash')).toBeNull();
    expect(screen.getByRole('heading', { name: '五谷丰登 ×2' })).toBeInTheDocument();
    expect(screen.getAllByRole('article')).toHaveLength(1); expect(complete).not.toHaveBeenCalled();
  });
  it('shows the already-saved rewards after video failure without requesting another draw', async () => {
    const complete = vi.fn(); const rendered = render(<DrawAnimation response={response()} onComplete={complete} />);
    fireEvent.error(rendered.container.querySelector('video')!);
    expect(await screen.findByRole('alert')).toHaveTextContent('视频无法播放；抽卡已完成，奖励已保存。');
    expect(screen.getByRole('heading', { name: '五谷丰登' })).toBeInTheDocument();
    expect(complete).not.toHaveBeenCalled();
  });
  it('offers manual play if autoplay is rejected and supports Escape cancellation', async () => {
    vi.mocked(HTMLMediaElement.prototype.play).mockRejectedValueOnce(new Error('Autoplay blocked'));
    const complete = vi.fn(); render(<DrawAnimation response={response()} onComplete={complete} />);
    const manual = await screen.findByRole('button', { name: '播放揭晓动画' });
    await userEvent.click(manual);
    await waitFor(() => expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(2));
    fireEvent(screen.getByRole('dialog'), new Event('cancel', { bubbles: true, cancelable: true }));
    expect(complete).toHaveBeenCalledOnce();
  });
});
