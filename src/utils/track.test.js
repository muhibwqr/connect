import { describe, expect, it } from 'vitest';
import { buildTrack, engagedIntervals, inIntervals, intervalsTotal, sampleTrack, shortestTurn } from './track';

// 11 points one second apart, heading due north ~11.1 m per step
const coords = Object.fromEntries(Array.from({ length: 11 }, (_, i) => [i, [0, i * 0.0001]]));

describe('track', () => {
  it('builds cumulative distance', () => {
    const track = buildTrack(coords);
    expect(track.ts).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(track.dist[0]).toEqual(0);
    expect(track.total).toBeCloseTo(111.2, 0);
  });

  it('handles missing coords', () => {
    expect(buildTrack(undefined).total).toEqual(0);
    expect(sampleTrack(buildTrack({}), 1000)).toBeNull();
  });

  it('interpolates position, speed and heading', () => {
    const s = sampleTrack(buildTrack(coords), 5500);
    expect(s.index).toEqual(5);
    expect(s.lat).toBeCloseTo(0.00055, 7);
    expect(s.dist).toBeCloseTo(61.2, 0);
    expect(s.speed).toBeCloseTo(11.1, 0);
    expect(s.heading).toBeCloseTo(0, 3);
  });

  it('has no heading when standing still', () => {
    const still = buildTrack({ 0: [1, 1], 1: [1, 1], 2: [1, 1] });
    const s = sampleTrack(still, 1000);
    expect(s.speed).toEqual(0);
    expect(s.heading).toBeNull();
  });

  it('turns the short way round', () => {
    expect(shortestTurn(350, 10)).toEqual(20);
    expect(shortestTurn(10, 350)).toEqual(-20);
    expect(shortestTurn(0, 180)).toEqual(-180);
  });

  it('merges overlapping engaged spans', () => {
    const ev = (s, e) => ({ type: 'engage', route_offset_millis: s, data: { end_route_offset_millis: e } });
    const spans = engagedIntervals([ev(5000, 8000), ev(0, 1000), ev(7000, 9000), { type: 'alert', route_offset_millis: 2 }]);
    expect(spans).toEqual([[0, 1000], [5000, 9000]]);
    expect(intervalsTotal(spans)).toEqual(5000);
    expect(inIntervals(spans, 500)).toBe(true);
    expect(inIntervals(spans, 1000)).toBe(false);
    expect(engagedIntervals(null)).toEqual([]);
  });
});
