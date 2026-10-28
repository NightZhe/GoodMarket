import { describe, expect, it } from 'vitest';
import type { StorageLike } from './pending';
import { createSessionStore, type AsyncStorageLike } from './sessionStore';

// 假的安全儲存（模擬 Capacitor 外掛：全部 async、可設定丟例外）與假的備援儲存（模擬 localStorage：同步）。
// 只記錄「被叫了哪個方法、哪個 key」，不記值，測試用 calls 看轉接器有沒有多碰不該碰的後端。
const secureFake = (opts: { throwOn?: Set<'getItem' | 'setItem' | 'removeItem'> } = {}) => {
  const m = new Map<string, string>();
  const calls: string[] = [];
  const maybeThrow = (op: 'getItem' | 'setItem' | 'removeItem') => {
    if (opts.throwOn?.has(op)) throw new Error('osError: keychain unavailable');
  };
  const store: AsyncStorageLike = {
    getItem: async k => { calls.push(`getItem:${k}`); maybeThrow('getItem'); return m.get(k) ?? null; },
    setItem: async (k, v) => { calls.push(`setItem:${k}`); maybeThrow('setItem'); m.set(k, v); },
    removeItem: async k => { calls.push(`removeItem:${k}`); maybeThrow('removeItem'); m.delete(k); },
  };
  return { store, calls, map: m };
};

const fallbackFake = () => {
  const m = new Map<string, string>();
  const calls: string[] = [];
  const store: StorageLike = {
    getItem: k => { calls.push(`getItem:${k}`); return m.get(k) ?? null; },
    setItem: (k, v) => { calls.push(`setItem:${k}`); m.set(k, v); },
    removeItem: k => { calls.push(`removeItem:${k}`); m.delete(k); },
  };
  return { store, calls, map: m };
};

const KEY = 'sb-test-auth-token';
const SESSION = '{"access_token":"eyJ-secret-access","refresh_token":"rt-secret-refresh"}';

describe('AC-1 安全儲存有值 → 直接回，不碰備援', () => {
  it('回安全儲存的值，備援一次都沒被讀', async () => {
    const secure = secureFake();
    secure.map.set(KEY, SESSION);
    const fallback = fallbackFake();
    const store = createSessionStore({ secure: async () => secure.store, fallback: fallback.store });
    await expect(store.getItem(KEY)).resolves.toBe(SESSION);
    expect(fallback.calls).toEqual([]);
  });
});

describe('AC-2 只有備援有值 → 搬進安全儲存、刪備援、回值；第二次讀不再碰備援', () => {
  it('舊版 App 升級：localStorage 的 session 搬到安全儲存，使用者不用重登', async () => {
    const secure = secureFake();
    const fallback = fallbackFake();
    fallback.map.set(KEY, SESSION);
    const store = createSessionStore({ secure: async () => secure.store, fallback: fallback.store });
    await expect(store.getItem(KEY)).resolves.toBe(SESSION);
    expect(secure.map.get(KEY)).toBe(SESSION);
    expect(fallback.map.has(KEY)).toBe(false);
    fallback.calls.length = 0;
    await expect(store.getItem(KEY)).resolves.toBe(SESSION);
    expect(fallback.calls).toEqual([]);
  });
});

describe('AC-3 兩邊都沒有 → null', () => {
  it('回 null，不丟例外', async () => {
    const store = createSessionStore({ secure: async () => secureFake().store, fallback: fallbackFake().store });
    await expect(store.getItem(KEY)).resolves.toBeNull();
  });
});

describe('AC-5 setItem 寫安全儲存並清掉備援的舊份；removeItem 兩邊都刪', () => {
  it('setItem：值只留在安全儲存，備援不留 token 副本', async () => {
    const secure = secureFake();
    const fallback = fallbackFake();
    fallback.map.set(KEY, 'stale-old-session');
    const store = createSessionStore({ secure: async () => secure.store, fallback: fallback.store });
    await store.setItem(KEY, SESSION);
    expect(secure.map.get(KEY)).toBe(SESSION);
    expect(fallback.map.has(KEY)).toBe(false);
  });
  it('removeItem（登出）：安全儲存與備援都沒了', async () => {
    const secure = secureFake();
    const fallback = fallbackFake();
    secure.map.set(KEY, SESSION);
    fallback.map.set(KEY, SESSION);
    const store = createSessionStore({ secure: async () => secure.store, fallback: fallback.store });
    await store.removeItem(KEY);
    expect(secure.map.has(KEY)).toBe(false);
    expect(fallback.map.has(KEY)).toBe(false);
  });
});

describe('AC-4 安全儲存丟例外 → 該次走備援、不向上丟；之後的呼叫都走備援', () => {
  it('getItem 丟例外：回備援的值；接著 setItem／getItem 都不再碰安全儲存', async () => {
    const secure = secureFake({ throwOn: new Set(['getItem']) });
    const fallback = fallbackFake();
    fallback.map.set(KEY, SESSION);
    const store = createSessionStore({ secure: async () => secure.store, fallback: fallback.store });
    await expect(store.getItem(KEY)).resolves.toBe(SESSION);
    expect(fallback.map.get(KEY)).toBe(SESSION);
    secure.calls.length = 0;
    await store.setItem(KEY, 'next-session');
    await expect(store.getItem(KEY)).resolves.toBe('next-session');
    await store.removeItem(KEY);
    expect(secure.calls).toEqual([]);
    expect(fallback.map.has(KEY)).toBe(false);
  });
  it('setItem 丟例外：值寫進備援、不丟；之後讀得到', async () => {
    const secure = secureFake({ throwOn: new Set(['setItem']) });
    const fallback = fallbackFake();
    const store = createSessionStore({ secure: async () => secure.store, fallback: fallback.store });
    await expect(store.setItem(KEY, SESSION)).resolves.toBeUndefined();
    expect(fallback.map.get(KEY)).toBe(SESSION);
    await expect(store.getItem(KEY)).resolves.toBe(SESSION);
  });
  it('外掛載入失敗（import 拒絕）：一切走備援，像今天一樣', async () => {
    const fallback = fallbackFake();
    const store = createSessionStore({ secure: async () => { throw new Error('plugin not available'); }, fallback: fallback.store });
    await store.setItem(KEY, SESSION);
    await expect(store.getItem(KEY)).resolves.toBe(SESSION);
    await store.removeItem(KEY);
    await expect(store.getItem(KEY)).resolves.toBeNull();
  });
  it('removeItem 丟例外：備援仍被刪、不丟', async () => {
    const secure = secureFake({ throwOn: new Set(['removeItem']) });
    const fallback = fallbackFake();
    fallback.map.set(KEY, SESSION);
    const store = createSessionStore({ secure: async () => secure.store, fallback: fallback.store });
    await expect(store.removeItem(KEY)).resolves.toBeUndefined();
    expect(fallback.map.has(KEY)).toBe(false);
  });
});

describe('AC-15 log 與錯誤訊息不含任何 key 的值', () => {
  it('安全儲存失效時有記 log，但 log 裡沒有 session 內容；例外訊息也不往外傳', async () => {
    const secure = secureFake({ throwOn: new Set(['getItem', 'setItem']) });
    const fallback = fallbackFake();
    const logs: string[] = [];
    const store = createSessionStore({ secure: async () => secure.store, fallback: fallback.store, log: m => { logs.push(m); } });
    await store.setItem(KEY, SESSION);
    await store.getItem(KEY);
    expect(logs.length).toBeGreaterThan(0);
    for (const line of logs) {
      expect(line).not.toContain(SESSION);
      expect(line).not.toContain('secret');
    }
  });
  it('正常路徑不產生 log', async () => {
    const secure = secureFake();
    const logs: string[] = [];
    const store = createSessionStore({ secure: async () => secure.store, fallback: fallbackFake().store, log: m => { logs.push(m); } });
    await store.setItem(KEY, SESSION);
    await store.getItem(KEY);
    await store.removeItem(KEY);
    expect(logs).toEqual([]);
  });
});
