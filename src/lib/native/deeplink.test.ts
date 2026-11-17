import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openNativeRoute } from './deeplink';

const REVIEW = 'io.github.nightzhe.goodmarket://review-login';

describe('deeplink：一般深連結切 hash 路由', () => {
  beforeEach(() => { vi.stubGlobal('window', { location: { hash: '' } }); });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('://review-login → #/review-login；query 保留', () => {
    openNativeRoute(REVIEW);
    expect(window.location.hash).toBe('#/review-login');
    openNativeRoute('io.github.nightzhe.goodmarket://orders?tab=done');
    expect(window.location.hash).toBe('#/orders?tab=done');
  });

  it('冷啟動 appUrlOpen 與 getLaunchUrl 給同一個網址：第二次已在該頁，不再動 hash', () => {
    const hashes: string[] = [];
    vi.stubGlobal('window', { location: { get hash() { return hashes[hashes.length - 1] ?? ''; }, set hash(v: string) { hashes.push(v); } } });
    openNativeRoute(REVIEW);
    openNativeRoute(REVIEW);
    expect(hashes).toEqual(['#/review-login']);
  });

  it('離開後再點同一個連結要能再進來（不以「網址看過」去重）', () => {
    openNativeRoute(REVIEW);
    window.location.hash = '#/';
    openNativeRoute(REVIEW);
    expect(window.location.hash).toBe('#/review-login');
  });

  it('登入回跳 ://auth 與別的 scheme 不處理', () => {
    openNativeRoute('io.github.nightzhe.goodmarket://auth?code=abc');
    openNativeRoute('https://nightzhe.github.io/GoodMarket/#/review-login');
    expect(window.location.hash).toBe('');
  });
});
