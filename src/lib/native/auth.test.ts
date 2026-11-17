import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// App 內登入回跳的去重：同一個 code 只能換一次 session。
// 模組內用 lastUrl 擋「冷啟動 appUrlOpen＋getLaunchUrl 給同一個網址」；localStorage 記已換過的 code 擋
// 「WebView 重新載入後 getLaunchUrl 又給同一個網址」（iOS 內容程序掛掉 reload、Android Activity 重建）——那時模組變數已經歸零。
// 這裡用 vi.resetModules() 模擬 JS 重新啟動。

const AUTH = 'io.github.nightzhe.goodmarket://auth';
const exchange = vi.fn<(code: string) => Promise<{ error: { message: string } | null }>>(async () => ({ error: null }));
const outcomes: string[] = [];

vi.mock('../supabase', () => ({ supabase: { auth: { exchangeCodeForSession: (code: string) => exchange(code), signInWithOAuth: vi.fn() } } }));
vi.mock('@capacitor/browser', () => ({ Browser: { close: vi.fn(async () => {}), open: vi.fn(async () => {}), addListener: vi.fn(async () => ({ remove: async () => {} })) } }));
vi.mock('./platform', () => ({ isNative: () => true, nativePlatform: () => 'android' }));
vi.mock('./callback', async importOriginal => {
  const real = await importOriginal<typeof import('./callback')>();
  return { ...real, postNativeAuthOutcome: (o: string) => { outcomes.push(o); } };
});

/** 假的 localStorage：node 測試環境沒有；可切成會丟例外的版本模擬被擋 */
function fakeStorage(blocked = false) {
  const m = new Map<string, string>();
  const guard = () => { if (blocked) throw new Error('blocked'); };
  return {
    getItem: (k: string) => { guard(); return m.get(k) ?? null; },
    setItem: (k: string, v: string) => { guard(); m.set(k, v); },
    removeItem: (k: string) => { guard(); m.delete(k); },
    size: () => m.size,
  };
}

const load = () => import('./auth');

beforeEach(() => { exchange.mockClear(); outcomes.length = 0; });
afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });

describe('handleNativeAuthUrl：登入回跳只換一次 session', () => {
  it('同一個模組內同一個網址兩次（appUrlOpen＋getLaunchUrl）只換一次', async () => {
    vi.stubGlobal('localStorage', fakeStorage());
    const { handleNativeAuthUrl } = await load();
    await handleNativeAuthUrl(`${AUTH}?code=abc`);
    await handleNativeAuthUrl(`${AUTH}?code=abc`);
    expect(exchange).toHaveBeenCalledTimes(1);
    expect(exchange).toHaveBeenCalledWith('abc');
    expect(outcomes).toEqual(['signed_in']);
  });

  it('WebView 重載（模組重新載入）後再拿到同一個 code：不再換、也不報失敗', async () => {
    const storage = fakeStorage();
    vi.stubGlobal('localStorage', storage);
    const first = await load();
    await first.handleNativeAuthUrl(`${AUTH}?code=abc`);
    expect(exchange).toHaveBeenCalledTimes(1);
    expect(storage.size()).toBe(1);

    vi.resetModules();
    const second = await load();
    await second.handleNativeAuthUrl(`${AUTH}?code=abc`);
    expect(exchange).toHaveBeenCalledTimes(1);
    expect(outcomes).toEqual(['signed_in']);
  });

  it('重載後拿到新的 code 照常換', async () => {
    vi.stubGlobal('localStorage', fakeStorage());
    const first = await load();
    await first.handleNativeAuthUrl(`${AUTH}?code=abc`);
    vi.resetModules();
    const second = await load();
    await second.handleNativeAuthUrl(`${AUTH}?code=def`);
    expect(exchange.mock.calls.map(c => c[0])).toEqual(['abc', 'def']);
    expect(outcomes).toEqual(['signed_in', 'signed_in']);
  });

  it('localStorage 被擋：仍靠 lastUrl 去重、不丟例外；換失敗回 failed', async () => {
    vi.stubGlobal('localStorage', fakeStorage(true));
    exchange.mockResolvedValueOnce({ error: { message: 'bad' } });
    const { handleNativeAuthUrl } = await load();
    await handleNativeAuthUrl(`${AUTH}?code=abc`);
    await handleNativeAuthUrl(`${AUTH}?code=abc`);
    expect(exchange).toHaveBeenCalledTimes(1);
    expect(outcomes).toEqual(['failed']);
  });

  it('不是 ://auth 的深連結、或供應商錯誤回跳：不換 code；錯誤回跳每次都回報', async () => {
    vi.stubGlobal('localStorage', fakeStorage());
    const { handleNativeAuthUrl } = await load();
    await handleNativeAuthUrl('io.github.nightzhe.goodmarket://review-login');
    await handleNativeAuthUrl(`${AUTH}?error=access_denied&error_description=user%20cancelled`);
    expect(exchange).not.toHaveBeenCalled();
    expect(outcomes).toEqual(['cancelled']);
  });
});
