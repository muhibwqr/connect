import { describe, expect, it } from 'vitest';
import { countUpTo, formatDuration, place, toPos } from './util';

describe('HUD util', () => {
  it('formats durations', () => {
    expect(formatDuration(0)).toEqual('0:00');
    expect(formatDuration(65_000)).toEqual('1:05');
    expect(formatDuration(3_725_000)).toEqual('1:02:05');
    expect(formatDuration(-5)).toEqual('0:00');
  });

  it('counts sorted values up to t', () => {
    expect(countUpTo([1, 2, 5], 0)).toEqual(0);
    expect(countUpTo([1, 2, 5], 2)).toEqual(2);
    expect(countUpTo([1, 2, 5], 9)).toEqual(3);
  });

  it('round-trips widget positions', () => {
    const W = 800; const H = 450; const w = 120; const h = 80;
    [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0.5, y: 1 }].forEach((pos) => {
      const { left, top } = place(pos, w, h, W, H);
      const back = toPos(left, top, w, h, W, H);
      expect(back.x).toBeCloseTo(pos.x, 5);
      expect(back.y).toBeCloseTo(pos.y, 5);
    });
  });
});
