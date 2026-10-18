import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { withAbortTimeout } from './rpcTimeout';

describe('withAbortTimeout', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('時間內完成：回傳值、沒有逾時，計時器被清掉', async () => {
    const r = await withAbortTimeout(1000, async () => 'ok');
    expect(r).toEqual({ value: 'ok', timedOut: false });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('逾時：abort 傳給呼叫端、結果標記 timedOut', async () => {
    const p = withAbortTimeout(1000, signal => new Promise<string>((_, reject) => {
      signal.addEventListener('abort', () => reject(new Error('aborted')));
    }));
    await vi.advanceTimersByTimeAsync(1000);
    expect(await p).toEqual({ value: null, timedOut: true });
  });

  it('沒逾時就丟出的錯誤照樣丟出去', async () => {
    await expect(withAbortTimeout(1000, async () => { throw new Error('boom'); })).rejects.toThrow('boom');
  });
});
