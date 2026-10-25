import { describe, expect, it } from 'vitest';
import { NATIVE_AUTH_REDIRECT, parseNativeCallback, parseNativeRoute } from './callback';

describe('parseNativeCallback', () => {
  it('讀出 code', () => {
    expect(parseNativeCallback(`${NATIVE_AUTH_REDIRECT}?code=abc-123`)).toEqual({ code: 'abc-123', failure: null });
  });
  it('使用者取消：query 或 hash 都看', () => {
    expect(parseNativeCallback(`${NATIVE_AUTH_REDIRECT}?error=access_denied`)).toEqual({ code: null, failure: 'cancelled' });
    expect(parseNativeCallback(`${NATIVE_AUTH_REDIRECT}#error=access_denied&error_code=user_cancelled`)).toEqual({ code: null, failure: 'cancelled' });
  });
  it('其他錯誤是 failed，且不拿 code 來登入', () => {
    expect(parseNativeCallback(`${NATIVE_AUTH_REDIRECT}?code=x&error=server_error`)).toEqual({ code: null, failure: 'failed' });
  });
  it('不是登入回跳的網址回 null', () => {
    expect(parseNativeCallback('https://nightzhe.github.io/GoodMarket/?code=x')).toBeNull();
    expect(parseNativeCallback('io.github.nightzhe.goodmarket://product/p1')).toBeNull();
    expect(parseNativeCallback('not a url')).toBeNull();
  });
  it('沒有參數就是什麼都沒有', () => {
    expect(parseNativeCallback(NATIVE_AUTH_REDIRECT)).toEqual({ code: null, failure: null });
  });
});

describe('parseNativeRoute', () => {
  it('scheme://review-login → /review-login（審查員登入頁）', () => {
    expect(parseNativeRoute('io.github.nightzhe.goodmarket://review-login')).toBe('/review-login');
    expect(parseNativeRoute('io.github.nightzhe.goodmarket://review-login/')).toBe('/review-login');
  });
  it('多層路徑與 query 保留，hash 丟掉', () => {
    expect(parseNativeRoute('io.github.nightzhe.goodmarket://product/p1?x=1#frag')).toBe('/product/p1?x=1');
  });
  it('登入回跳不是一般深連結', () => {
    expect(parseNativeRoute('io.github.nightzhe.goodmarket://auth?code=x')).toBeNull();
    expect(parseNativeRoute('io.github.nightzhe.goodmarket://auth/')).toBeNull();
  });
  it('安全驗證回跳不是一般深連結（token 不能進 hash 路由）', () => {
    expect(parseNativeRoute('io.github.nightzhe.goodmarket://captcha?token=x')).toBeNull();
    expect(parseNativeRoute('io.github.nightzhe.goodmarket://captcha/')).toBeNull();
  });
  it('別的 scheme、壞網址回 null', () => {
    expect(parseNativeRoute('https://nightzhe.github.io/GoodMarket/#/review-login')).toBeNull();
    expect(parseNativeRoute('not a url')).toBeNull();
  });
});
