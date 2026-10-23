import { describe, expect, it } from 'vitest';
import { NATIVE_AUTH_REDIRECT, parseNativeCallback } from './callback';

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
