import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { CardCollectionItem } from '@lecpunch/shared';
import { IdleCardOrbit, selectOrbitCards } from './IdleCardOrbit';
vi.mock('./CardArt', () => ({ CardArt: ({ name }: { name: string }) => <span>{name}图像</span> }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const animationFrames = () => {
  let id = 0, now = 0;
  const callbacks = new Map<number, FrameRequestCallback>();
  vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => { callbacks.set(++id, callback); return id; }));
  vi.stubGlobal('cancelAnimationFrame', vi.fn((key: number) => { callbacks.delete(key); }));
  return {
    tick: () => { now += 16; const pending = [...callbacks.values()]; callbacks.clear(); pending.forEach(callback => callback(now)); },
    settle: () => { for (let i = 0; callbacks.size && i < 200; i++) { now += 16; const pending = [...callbacks.values()]; callbacks.clear(); pending.forEach(callback => callback(now)); } },
    pending: () => callbacks.size
  };
};
const cards = (): CardCollectionItem[] => Array.from({ length: 21 }, (_, i) => ({ id: `card-${String(i).padStart(2, '0')}`, rarity: i < 4 ? 'N' : i < 11 ? 'R' : i < 18 ? 'SR' : 'SSR', unlocked: false, quantity: 0 }));
describe('IdleCardOrbit', () => {
  it('supports bidirectional wheel/keyboard control and preserves browser zoom gestures', () => {
    const frames = animationFrames();
    const rendered = render(<IdleCardOrbit collection={cards()} />);
    const stage = screen.getByRole('group', { name: '可交互卡阵' });
    const forward = new WheelEvent('wheel', { deltaY: 120, bubbles: true, cancelable: true });
    fireEvent(stage, forward); expect(forward.defaultPrevented).toBe(true);
    expect(stage.style.getPropertyValue('--orbit-offset')).toBe('');
    frames.tick(); const first = parseFloat(stage.style.getPropertyValue('--orbit-offset'));
    expect(first).toBeGreaterThan(0); expect(first).toBeLessThan(21.6);
    frames.settle(); expect(parseFloat(stage.style.getPropertyValue('--orbit-offset'))).toBeCloseTo(21.6);
    fireEvent.wheel(stage, { deltaY: -120, cancelable: true });
    frames.settle(); expect(stage.style.getPropertyValue('--orbit-offset')).toBe('0deg');
    fireEvent.keyDown(stage, { key: 'ArrowLeft' });
    expect(stage.style.getPropertyValue('--orbit-offset')).toBe('-15deg');
    fireEvent.keyDown(stage, { key: 'ArrowRight' });
    expect(stage.style.getPropertyValue('--orbit-offset')).toBe('0deg');
    const zoom = new WheelEvent('wheel', { deltaY: 120, ctrlKey: true, cancelable: true });
    fireEvent(stage, zoom); expect(zoom.defaultPrevented).toBe(false);
    expect(stage.style.getPropertyValue('--orbit-offset')).toBe('0deg');
    fireEvent.wheel(stage, { deltaX: 80, cancelable: true });
    frames.settle(); expect(parseFloat(stage.style.getPropertyValue('--orbit-offset'))).toBeCloseTo(14.4);
    fireEvent.keyDown(stage, { key: 'Home' });
    expect(stage.style.getPropertyValue('--orbit-offset')).toBe('0deg');
    fireEvent.wheel(stage, { deltaY: 120, cancelable: true }); expect(frames.pending()).toBe(1);
    rendered.unmount(); fireEvent.wheel(stage, { deltaY: 100, cancelable: true });
    expect(frames.pending()).toBe(0); expect(stage.style.getPropertyValue('--orbit-offset')).toBe('0deg');
  });
  it('coalesces wheel bursts into a single frame loop and interpolates across 360 without reversing', () => {
    const frames = animationFrames(); render(<IdleCardOrbit collection={cards()} />);
    const stage = screen.getByRole('group', { name: '可交互卡阵' });
    for (let i = 0; i < 23; i++) fireEvent.keyDown(stage, { key: 'ArrowRight' });
    expect(parseFloat(stage.style.getPropertyValue('--orbit-offset'))).toBe(345);
    fireEvent.wheel(stage, { deltaY: 120, cancelable: true });
    fireEvent.wheel(stage, { deltaY: 120, cancelable: true });
    expect(frames.pending()).toBe(1); frames.tick();
    expect(parseFloat(stage.style.getPropertyValue('--orbit-offset'))).toBeGreaterThan(345);
    frames.settle(); expect(parseFloat(stage.style.getPropertyValue('--orbit-offset'))).toBeCloseTo(388.2);
    fireEvent.wheel(stage, { deltaY: -120, cancelable: true }); frames.settle();
    expect(parseFloat(stage.style.getPropertyValue('--orbit-offset'))).toBeCloseTo(366.6);
  });
  it('reverses on the next frame instead of finishing a queued forward burst', () => {
    const frames = animationFrames(); render(<IdleCardOrbit collection={cards()} />);
    const stage = screen.getByRole('group', { name: '可交互卡阵' });
    for (let i = 0; i < 6; i++) fireEvent.wheel(stage, { deltaY: 120, cancelable: true });
    frames.tick(); const before = parseFloat(stage.style.getPropertyValue('--orbit-offset'));
    fireEvent.wheel(stage, { deltaY: -120, cancelable: true }); frames.tick();
    expect(parseFloat(stage.style.getPropertyValue('--orbit-offset'))).toBeLessThan(before);
    frames.settle(); expect(frames.pending()).toBe(0);
  });
  it('selects at most eight representatives across rarities and reveals obtained cards without metadata for unknown ones', () => {
    const collection = cards(); collection[6] = { ...collection[6], unlocked: true, name: '已发现测试卡' };
    const picked = selectOrbitCards(collection);
    expect(picked).toHaveLength(8); expect(new Set(picked.map(card => card.rarity)).size).toBe(4);
    expect(picked.some(card => card.id === collection[6].id)).toBe(true);
    const rendered = render(<IdleCardOrbit collection={collection} />);
    expect(rendered.container.querySelectorAll('[data-orbit-card]')).toHaveLength(8);
    expect(screen.getAllByText('已发现测试卡图像')).toHaveLength(2);
    expect(rendered.container.querySelectorAll('.card-orbit-unknown')).toHaveLength(14);
    for (const card of rendered.container.querySelectorAll('[data-orbit-card]')) {
      expect(card.querySelector('.card-orbit-back')?.innerHTML).toBe(card.querySelector('.card-orbit-front')?.innerHTML);
    }
  });
  it('supports explicit pause and resume without firing or simulating a draw', async () => {
    const rendered = render(<IdleCardOrbit collection={cards()} />);
    await userEvent.click(screen.getByRole('button', { name: '暂停旋绕' }));
    expect(rendered.container.querySelector('.card-orbit-stage')).toHaveAttribute('data-paused', 'true');
    await userEvent.click(screen.getByRole('button', { name: '继续旋绕' }));
    expect(rendered.container.querySelector('.card-orbit-stage')).toHaveAttribute('data-paused', 'false');
    expect(rendered.container.querySelector('.card-draw-animation-slot')).toBeNull();
  });
  it('passes confirmed draw state to an optional future animation slot without taking over business writes', () => {
    const state = { pending: false, result: { message: '服务端确认结果' } };
    const slot = vi.fn(value => <p>{value.result.message}</p>);
    render(<IdleCardOrbit collection={cards()} animationState={state} renderDrawAnimation={slot} />);
    expect(slot).toHaveBeenCalledWith(state); expect(screen.getByText('服务端确认结果')).toBeInTheDocument();
  });
});
