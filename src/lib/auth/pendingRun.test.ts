import { describe, expect, it } from 'vitest';
import { pendingRunKey, type RunGate } from './pendingRun';

const ready: RunGate = { runPendingOnLoad: false, phoneLoginTick: 0, lastRanKey: null, authReady: true, loading: false, hasUser: true, shopReady: true };

describe('待辦動作什麼時候執行（R-8）', () => {
  it('一般載入、沒人按確認：不執行（網址帶來的動作不能自動執行，B-2）', () => {
    expect(pendingRunKey(ready)).toBeNull();
  });
  it('手機驗證成功（tick > 0）且資料都就緒：執行', () => {
    expect(pendingRunKey({ ...ready, phoneLoginTick: 1 })).toBe(1);
  });
  it('一定要等 shopReady，否則 D12（不能買自己的店）會被跳過', () => {
    expect(pendingRunKey({ ...ready, phoneLoginTick: 1, shopReady: false })).toBeNull();
  });
  it('等 user、authReady、商品載入完', () => {
    expect(pendingRunKey({ ...ready, phoneLoginTick: 1, hasUser: false })).toBeNull();
    expect(pendingRunKey({ ...ready, phoneLoginTick: 1, authReady: false })).toBeNull();
    expect(pendingRunKey({ ...ready, phoneLoginTick: 1, loading: true })).toBeNull();
  });
  it('只執行一次：同一個 key 做過就不再做（重新整理、StrictMode 重跑、資料更新都不會再觸發）', () => {
    expect(pendingRunKey({ ...ready, phoneLoginTick: 1, lastRanKey: 1 })).toBeNull();
  });
  it('同一次載入內再登入一次（登出後重新手機登入）：新的 key，可以再執行一次', () => {
    expect(pendingRunKey({ ...ready, phoneLoginTick: 2, lastRanKey: 1 })).toBe(2);
  });
  it('Google／Apple 轉址回來（runPendingOnLoad）照舊執行一次', () => {
    expect(pendingRunKey({ ...ready, runPendingOnLoad: true })).toBe(0);
    expect(pendingRunKey({ ...ready, runPendingOnLoad: true, lastRanKey: 0 })).toBeNull();
  });
  it('轉址回來之後同一次載入內又用手機登入：還能再執行', () => {
    expect(pendingRunKey({ ...ready, runPendingOnLoad: true, phoneLoginTick: 1, lastRanKey: 0 })).toBe(1);
  });
});
