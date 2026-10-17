import { describe, expect, it } from 'vitest';
import { buildExternalUrl, detectInApp, isIOS } from './inapp';
import { buildPending } from './pending';

const NOW = 1_800_000_000_000;
const UA = {
  safari: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  chrome: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0.0.0 Mobile/15E148 Safari/604.1',
  line: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Safari Line/14.8.0',
  lineAndroid: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/126.0.0.0 Mobile Safari/537.36 Line/14.8.0/IAB',
  fbIos: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/470.0.0;FBBV/1;FBDV/iPhone15,2;FBMD/iPhone;FBSN/iOS;FBSV/17.5;FBLC/zh_TW]',
  fbAndroid: 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/126.0 Mobile Safari/537.36 [FB_IAB/FB4A;FBAV/470.0.0.0;]',
  ig: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 330.0.0.0 (iPhone15,2; iOS 17_5; zh_TW; zh-Hant-TW; scale=3.00; 1179x2556; 123)',
};

describe('detectInApp', () => {
  it.each([
    ['safari', null], ['chrome', null], ['line', 'line'], ['lineAndroid', 'line'],
    ['fbIos', 'facebook'], ['fbAndroid', 'facebook'], ['ig', 'instagram'],
  ] as const)('%s → %s', (k, expected) => expect(detectInApp(UA[k])).toBe(expected));
  it('空字串與桌機', () => {
    expect(detectInApp('')).toBeNull();
    expect(detectInApp('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/17.5 Safari/605.1.15')).toBeNull();
  });
  it('isIOS', () => {
    expect(isIOS(UA.line)).toBe(true);
    expect(isIOS(UA.lineAndroid)).toBe(false);
  });
});

describe('buildExternalUrl', () => {
  const loc = { origin: 'https://nightzhe.github.io', pathname: '/GoodMarket/', hash: '#/product/p1' };
  const pending = buildPending({ kind: 'add_to_cart', productId: 'p1', variantId: 'v 1', qty: 2 }, '/product/p1', NOW);

  it('LINE：openExternalBrowser 在 # 之前，待辦動作跟在 query 裡', () => {
    const url = buildExternalUrl(loc, pending, true);
    expect(url.startsWith('https://nightzhe.github.io/GoodMarket/?openExternalBrowser=1&pa=cart&pp=p1&pv=v+1&pq=2&pt=')).toBe(true);
    expect(url.endsWith('#/product/p1')).toBe(true);
    expect(url.indexOf('?')).toBeLessThan(url.indexOf('#'));
  });
  it('FB／IG 複製連結：不帶 openExternalBrowser，但帶待辦動作', () => {
    const url = buildExternalUrl(loc, pending, false);
    expect(url).not.toContain('openExternalBrowser');
    expect(url).toContain('pa=cart');
  });
  it('沒有待辦動作：只有 openExternalBrowser；都沒有就是原網址', () => {
    expect(buildExternalUrl(loc, null, true)).toBe('https://nightzhe.github.io/GoodMarket/?openExternalBrowser=1#/product/p1');
    expect(buildExternalUrl(loc, null, false)).toBe('https://nightzhe.github.io/GoodMarket/#/product/p1');
  });
  it('結帳資料不放網址', () => {
    const co = buildPending({ kind: 'checkout', items: [{ productId: 'p', variantId: 'v', qty: 1 }], fromCart: true, payment: 'cod', buyer: { name: '甲', phone: '0912345678', address: '某地址某地址' } }, '/checkout', NOW);
    expect(buildExternalUrl(loc, co, true)).not.toContain('0912345678');
  });
});
