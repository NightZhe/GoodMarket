import { describe, expect, it } from 'vitest';
import { classifyAuthError, parseLocation, privacyUrl, redirectUrl, withRoute } from './callback';

const NOW = 1_800_000_000_000;
const P = '/GoodMarket/';

describe('parseLocation：?code=（PKCE 回跳，不帶 #）', () => {
  it('讀到 code，網址清成乾淨的子路徑', () => {
    const r = parseLocation(P, '?code=abc123', '', NOW);
    expect(r.callback).toEqual({ code: 'abc123', failure: null });
    expect(r.dirty).toBe(true);
    expect(r.cleanedHref).toBe('/GoodMarket/');
  });
  it('保留 hash 路由與其他 query', () => {
    const r = parseLocation(P, '?q=1&code=abc', '#/product/p1', NOW);
    expect(r.cleanedHref).toBe('/GoodMarket/?q=1#/product/p1');
    expect(r.route).toBe('/product/p1');
  });
  it('一般開站：什麼都沒有、不需要清', () => {
    const r = parseLocation(P, '', '#/cart', NOW);
    expect(r.callback).toEqual({ code: null, failure: null });
    expect(r.dirty).toBe(false);
    expect(r.cleanedHref).toBe('/GoodMarket/#/cart');
  });
});

describe('parseLocation：錯誤參數在 query 或 hash 都要處理', () => {
  it('query：使用者取消', () => {
    const r = parseLocation(P, '?error=access_denied&error_code=access_denied&error_description=User+denied', '', NOW);
    expect(r.callback.failure).toBe('cancelled');
    expect(r.cleanedHref).toBe('/GoodMarket/');
  });
  it('hash：Supabase 文件說錯誤用 fragment 回傳', () => {
    const r = parseLocation(P, '', '#error=access_denied&error_code=bad&error_description=denied', NOW);
    expect(r.callback.failure).toBe('cancelled');
    expect(r.cleanedHref).toBe('/GoodMarket/');
  });
  it('其他錯誤＝失敗', () => {
    const r = parseLocation(P, '?error=server_error&error_description=Unable+to+exchange+external+code', '', NOW);
    expect(r.callback.failure).toBe('failed');
  });
  it('有錯誤時就算同時有 code 也不拿去換', () => {
    expect(parseLocation(P, '?code=x&error=server_error', '', NOW).callback.code).toBeNull();
  });
  it('錯誤放 hash 時，hash 整段清掉（不是路由）', () => {
    expect(parseLocation(P, '', '#error=server_error', NOW).cleanedHref).toBe('/GoodMarket/');
  });
});

describe('舊 implicit 流程的 token 不留在網址上、也不拿來登入（AC-14）', () => {
  it('hash 上的 token 整段清掉', () => {
    const r = parseLocation(P, '', '#access_token=aaa&refresh_token=bbb&expires_in=3600&token_type=bearer', NOW);
    expect(r.callback).toEqual({ code: null, failure: null });
    expect(r.cleanedHref).toBe('/GoodMarket/');
    expect(r.dirty).toBe(true);
  });
});

describe('classifyAuthError', () => {
  it.each([
    [{ error: 'access_denied' }, 'cancelled'],
    [{ errorCode: 'access_denied' }, 'cancelled'],
    [{ description: 'user_cancelled_authorize' }, 'cancelled'],
    [{ description: 'The user denied the request' }, 'cancelled'],
    [{ error: 'server_error', description: 'Unable to exchange external code' }, 'failed'],
    [{ error: 'invalid_request' }, 'failed'],
    [{}, 'failed'],
  ] as const)('%j → %s', (e, expected) => expect(classifyAuthError(e)).toBe(expected));
});

describe('LINE 外開網址帶來的參數', () => {
  it('讀出待辦動作，並把 openExternalBrowser 與 pa* 參數從網址清掉', () => {
    const r = parseLocation(P, `?openExternalBrowser=1&pa=cart&pp=p1&pv=v1&pq=3&pt=${NOW - 1000}`, '#/product/p1', NOW);
    expect(r.handoff).toMatchObject({ kind: 'add_to_cart', productId: 'p1', variantId: 'v1', qty: 3, returnTo: '/product/p1', createdAt: NOW - 1000 });
    expect(r.cleanedHref).toBe('/GoodMarket/#/product/p1');
  });
  it('參數被亂改就當作沒有，但還是清掉', () => {
    const r = parseLocation(P, '?pa=cart&pp=p1&pv=v1&pq=-1', '#/product/p1', NOW);
    expect(r.handoff).toBeNull();
    expect(r.cleanedHref).toBe('/GoodMarket/#/product/p1');
  });
  it('pa=login 回到網址上的 hash 路由', () => {
    expect(parseLocation(P, '?pa=login', '#/orders', NOW).handoff).toMatchObject({ kind: 'goto', returnTo: '/orders' });
  });
});

describe('網址組裝（GitHub Pages 子路徑）', () => {
  const loc = { origin: 'https://nightzhe.github.io', pathname: '/GoodMarket/' };
  it('回跳網址不帶 query 與 hash（R-4）', () => expect(redirectUrl(loc)).toBe('https://nightzhe.github.io/GoodMarket/'));
  it('隱私政策網址', () => expect(privacyUrl(loc)).toBe('https://nightzhe.github.io/GoodMarket/#/privacy'));
  it('withRoute 換掉 hash 路由、保留 query', () => {
    expect(withRoute('/GoodMarket/?q=1#/cart', '/product/p1')).toBe('/GoodMarket/?q=1#/product/p1');
    expect(withRoute('/GoodMarket/', '/orders')).toBe('/GoodMarket/#/orders');
  });
});
