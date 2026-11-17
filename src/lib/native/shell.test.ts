import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// 殼的啟動順序：Android 把「監聽登記前就送到、暫存的」appUrlOpen 只交給第一個登記的監聽者，
// 所以 shell.ts 只登記一個監聽，同一個網址同時交給登入回跳（auth）與一般深連結（deeplink）；冷啟動再查一次 getLaunchUrl 也餵給兩邊。
// 這裡用假的 App 外掛：addListener('appUrlOpen') 當下就重播一個暫存事件，getLaunchUrl 回同一個網址。

const REVIEW = 'io.github.nightzhe.goodmarket://review-login';
const order: string[] = [];
const listeners: Record<string, (e: never) => void> = {};
let retained: string | null = null;

vi.mock('@capacitor/app', () => ({
  App: {
    addListener: vi.fn(async (name: string, cb: (e: never) => void) => {
      order.push(`listen:${name}`);
      listeners[name] = cb;
      if (name === 'appUrlOpen' && retained) { (cb as (e: { url: string }) => void)({ url: retained }); retained = null; }
      return { remove: async () => {} };
    }),
    getLaunchUrl: vi.fn(async () => { order.push('getLaunchUrl'); return { url: REVIEW }; }),
    exitApp: vi.fn(async () => { order.push('exitApp'); }),
  },
}));
vi.mock('@capacitor/status-bar', () => ({ StatusBar: { setStyle: async () => {} }, Style: { Light: 'LIGHT' } }));
vi.mock('./platform', () => ({ isNative: () => true, nativePlatform: () => 'android' }));
vi.mock('./auth', () => ({
  initNativeAuth: vi.fn(async () => { order.push('initNativeAuth'); }),
  handleNativeAuthUrl: vi.fn(async (url: string) => { order.push(`auth:${url}`); }),
}));
vi.mock('./deeplink', () => ({ openNativeRoute: vi.fn((url: string) => { order.push(`route:${url}`); }) }));
vi.mock('../layout/posture', () => ({ startPosture: () => null, refreshPosture: () => {} }));

const classes = new Set<string>();
const win = {
  dispatchEvent: vi.fn(() => true),
  history: { back: vi.fn() },
  location: { hash: '' },
};
beforeEach(() => {
  order.length = 0;
  for (const k of Object.keys(listeners)) delete listeners[k];
  retained = REVIEW;
  classes.clear();
  win.dispatchEvent.mockClear();
  win.history.back.mockClear();
  vi.stubGlobal('window', win);
  vi.stubGlobal('document', {
    documentElement: { classList: { add: (...c: string[]) => c.forEach(x => classes.add(x)), toggle: () => {} } },
    body: {},
    querySelector: () => null,
  });
  vi.stubGlobal('MutationObserver', class { observe() {} });
  vi.stubGlobal('CustomEvent', class { constructor(public type: string, public init?: unknown) {} });
});
afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });

describe('shell：Android 殼的啟動', () => {
  it('appUrlOpen 只登記一次、在 initNativeAuth 之前；暫存事件與 getLaunchUrl 的網址都同時交給 auth 與 deeplink', async () => {
    const { initNativeShell } = await import('./shell');
    await initNativeShell();
    expect(order.filter(x => x === 'listen:appUrlOpen')).toHaveLength(1);
    expect(order.indexOf('listen:appUrlOpen')).toBeLessThan(order.indexOf('initNativeAuth'));
    // 暫存事件（登記當下重播）與 getLaunchUrl 各餵一次：兩邊各自對同一個網址去重，這裡只驗兩邊都收到
    expect(order.filter(x => x === `auth:${REVIEW}`)).toHaveLength(2);
    expect(order.filter(x => x === `route:${REVIEW}`)).toHaveLength(2);
    expect(classes.has('native')).toBe(true);
    expect(classes.has('native-android')).toBe(true);
  });

  it('返回鍵：覆蓋層先接手；沒有覆蓋層且畫面沒攔截時，能回就回上一頁、到底就離開 App', async () => {
    const { initNativeShell } = await import('./shell');
    const { pushNativeBack } = await import('./backStack');
    await initNativeShell();
    const back = listeners.backButton as unknown as (e: { canGoBack: boolean }) => void;
    expect(back).toBeTypeOf('function');
    const off = pushNativeBack(vi.fn());
    back({ canGoBack: true });
    expect(win.dispatchEvent).not.toHaveBeenCalled();
    expect(win.history.back).not.toHaveBeenCalled();
    off();
    back({ canGoBack: true });
    expect(win.dispatchEvent).toHaveBeenCalledTimes(1);
    expect(win.history.back).toHaveBeenCalledTimes(1);
    back({ canGoBack: false });
    expect(order).toContain('exitApp');
  });

  it('畫面攔截返回鍵（dispatchEvent 回 false＝preventDefault）就不回上一頁', async () => {
    win.dispatchEvent.mockReturnValue(false);
    const { initNativeShell } = await import('./shell');
    await initNativeShell();
    (listeners.backButton as unknown as (e: { canGoBack: boolean }) => void)({ canGoBack: true });
    expect(win.history.back).not.toHaveBeenCalled();
    expect(order).not.toContain('exitApp');
  });
});
