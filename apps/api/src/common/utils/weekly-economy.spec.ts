import { describe, expect, it } from 'vitest';
import { comprehensiveDurationSeconds, weeklyDrawPoints } from '@lecpunch/shared';

describe('unified comprehensive-time economy', () => {
  it('combines signed seconds before rounding without clamping the duration or balance', () => {
    const total = comprehensiveDurationSeconds(59, 59, 2);
    expect(total).toBe(120);
    expect(weeklyDrawPoints(comprehensiveDurationSeconds(59, 59), 2, 0)).toMatchObject({ earned: 2, balance: 2, comprehensiveSeconds: total });
    expect(comprehensiveDurationSeconds(60, -120, -900)).toBe(-960);
    expect(weeklyDrawPoints(0, -900, 60)).toMatchObject({ earned: -15, balance: -75, spent: 60 });
    expect(weeklyDrawPoints(-1200, 0, 30)).toMatchObject({ comprehensiveSeconds: -1200, earned: -20, balance: -50 });
  });
  it('preserves consumption debt after attacks, then recovers only when time is sufficient', () => {
    expect(weeklyDrawPoints(7200, -1800, 60).balance).toBe(30);
    expect(weeklyDrawPoints(7200, -5400, 60).balance).toBe(-30);
    expect(weeklyDrawPoints(7200, -3600, 60).balance).toBe(0);
    expect(weeklyDrawPoints(7200, -1800, 60).balance).toBe(30);
  });
  it.each([NaN, Infinity, 0.5, Number.MAX_SAFE_INTEGER + 1])('rejects invalid durations and consumption: %s', invalid => {
    expect(() => comprehensiveDurationSeconds(invalid)).toThrow();
    expect(() => weeklyDrawPoints(0, invalid, 0)).toThrow();
    expect(() => weeklyDrawPoints(0, 0, invalid)).toThrow();
  });
  it('rejects overflow and negative attendance or consumption', () => {
    expect(() => comprehensiveDurationSeconds(Number.MAX_SAFE_INTEGER, 1)).toThrow();
    expect(() => comprehensiveDurationSeconds(0, 0, Number.MAX_SAFE_INTEGER + 1)).toThrow();
    expect(() => comprehensiveDurationSeconds(-1)).toThrow();
    expect(() => weeklyDrawPoints(-60, 0, Number.MAX_SAFE_INTEGER)).toThrow();
    expect(() => weeklyDrawPoints(0, 0, -1)).toThrow();
  });
});
