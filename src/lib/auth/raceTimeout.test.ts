import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { raceTimeout } from './raceTimeout';

describe('請求逾時', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('時間內回來：用回應，不會再觸發逾時', async () => {
    const p = raceTimeout(new Promise<string>(r => setTimeout(() => r('ok'), 1000)), 15_000, () => 'timeout');
    await vi.advanceTimersByTimeAsync(1000);
    expect(await p).toBe('ok');
    await vi.advanceTimersByTimeAsync(20_000);
  });
  it('一直不回來：時間到就放棄等待', async () => {
    const p = raceTimeout(new Promise<string>(() => {}), 15_000, () => 'timeout');
    await vi.advanceTimersByTimeAsync(14_999);
    let done = false;
    void p.then(() => { done = true; });
    await vi.advanceTimersByTimeAsync(0);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await p).toBe('timeout');
  });
  it('時間內丟錯誤：照樣丟出去', async () => {
    const p = raceTimeout(Promise.reject(new Error('boom')), 15_000, () => 'timeout');
    await expect(p).rejects.toThrow('boom');
  });
});
