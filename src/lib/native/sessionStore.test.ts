import { afterEach, describe, expect, it, vi } from 'vitest';

// Capacitor 的 registerPlugin 回傳的是 Proxy：任何屬性名（包括 then）都回一個「原生方法包裝」。
// 把這個 Proxy 直接當 Promise 的 resolve 值，會被當成 thenable 去呼叫 then → 永遠不 resolve（TestFlight build 4 首頁永遠骨架）。
// 這裡模擬那個 Proxy：then 回一個永遠不呼叫 callback 的函式。
const calls: string[] = [];
const store = new Map<string, string>();
const capacitorLikeProxy = new Proxy({}, {
  get: (_t, prop: string) => {
    if (prop === 'then') return () => { calls.push('then'); /* 永遠不回呼 */ };
    if (prop === 'getItem') return async (k: string) => { calls.push('getItem'); return store.get(k) ?? null; };
    if (prop === 'setItem') return async (k: string, v: string) => { calls.push('setItem'); store.set(k, v); };
    if (prop === 'removeItem') return async (k: string) => { calls.push('removeItem'); store.delete(k); };
    return () => { calls.push(String(prop)); };
  },
});
vi.mock('@aparajita/capacitor-secure-storage', () => ({ SecureStorage: capacitorLikeProxy }));

afterEach(() => { calls.length = 0; store.clear(); });

describe('App 內 session 儲存：外掛是 Capacitor Proxy（thenable 陷阱）', () => {
  it('getItem 會回來，不會永遠 pending；而且沒有呼叫到 Proxy 的 then', async () => {
    const { nativeSessionStore } = await import('./sessionStore');
    const s = nativeSessionStore();
    await s.setItem('k', 'v');
    await expect(s.getItem('k')).resolves.toBe('v');
    await s.removeItem('k');
    await expect(s.getItem('k')).resolves.toBeNull();
    expect(calls).not.toContain('then');
    expect(calls).toEqual(['setItem', 'getItem', 'removeItem', 'getItem']);
  }, 3000);
});
