import { afterEach, describe, expect, it, vi } from 'vitest';

describe('frameClock', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('runs one loop for all subscribers and stops when the last leaves', async () => {
    const queue = [];
    vi.stubGlobal('requestAnimationFrame', vi.fn((cb) => queue.push(cb)));
    vi.stubGlobal('cancelAnimationFrame', vi.fn(() => queue.splice(0)));
    vi.resetModules();
    const { onFrame } = await import('./frameClock');
    const a = vi.fn();
    const b = vi.fn();
    const stopA = onFrame(a);
    const stopB = onFrame(b);
    expect(requestAnimationFrame).toHaveBeenCalledTimes(1);

    queue.shift()(16);
    expect(a).toHaveBeenCalledWith(16);
    expect(b).toHaveBeenCalledWith(16);

    stopA();
    queue.shift()(32);
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(2);

    stopB();
    expect(cancelAnimationFrame).toHaveBeenCalled();
    expect(queue).toEqual([]);
  });
});
