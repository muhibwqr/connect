import { beforeEach, describe, expect, it, vi } from 'vitest';

const KEY = 'glassHud:v2';
const loadStore = async () => {
  vi.resetModules();
  return import('./store');
};

describe('HUD settings store', () => {
  beforeEach(() => window.localStorage.clear());

  it('starts with the square minimap and top-left bars', async () => {
    const { setHud } = await loadStore();
    let seen;
    setHud((s) => { seen = s; return {}; });
    expect(seen.shape).toEqual('square');
    expect(seen.statsPos).toBeNull();
    expect(seen.stats.alerts).toBe(false);
  });

  it('persists changes and merges saved stats over new defaults', async () => {
    window.localStorage.setItem(KEY, JSON.stringify({ mapSize: 0.5, stats: { speed: false } }));
    const { setHud } = await loadStore();
    let seen;
    setHud((s) => { seen = s; return { mapZoom: 12 }; });
    expect(seen.mapSize).toEqual(0.5);
    expect(seen.stats).toMatchObject({ speed: false, distance: true, engaged: true });
    expect(JSON.parse(window.localStorage.getItem(KEY)).mapZoom).toEqual(12);
  });

  it('ignores corrupt storage and resets to defaults', async () => {
    window.localStorage.setItem(KEY, '{not json');
    const { setHud, resetHud } = await loadStore();
    setHud({ shape: 'circle' });
    resetHud();
    let seen;
    setHud((s) => { seen = s; return {}; });
    expect(seen.shape).toEqual('square');
  });
});
