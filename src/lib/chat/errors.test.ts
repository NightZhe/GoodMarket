import { describe, expect, it } from 'vitest';
import { ChatError, isMissingFunction, isUnavailable, openFailure, sendFailureText, toChatError, toErrorCode } from './errors';

describe('錯誤碼', () => {
  it('認得資料庫的 hint，不認得的（PostgREST 自己的提示）當成沒有錯誤碼', () => {
    expect(toErrorCode('CANNOT_SEND')).toBe('CANNOT_SEND');
    expect(toErrorCode('Perhaps you meant to call...')).toBeNull();
    expect(toErrorCode(null)).toBeNull();
    expect(toErrorCode(undefined)).toBeNull();
  });

  it('函式不存在（資料庫沒升級）有三種長相，都判為降級；一般錯誤不算', () => {
    expect(isMissingFunction({ code: 'PGRST202' })).toBe(true);
    expect(isMissingFunction({ code: '42883' })).toBe(true);
    expect(isMissingFunction({ status: 404 })).toBe(true);
    expect(isMissingFunction({ code: 'P0001', hint: 'LOGIN_REQUIRED' })).toBe(false);
    expect(isMissingFunction({ message: 'Failed to fetch' })).toBe(false);
    expect(isMissingFunction(null)).toBe(false);
  });

  it('toChatError：降級優先於 hint；沒有 hint＝null（可重試）', () => {
    expect(toChatError({ code: 'PGRST202', message: 'x' }).code).toBe('UNAVAILABLE');
    expect(toChatError({ code: 'P0001', hint: 'RATE_LIMITED', message: 'x' }).code).toBe('RATE_LIMITED');
    expect(toChatError({ message: 'Failed to fetch' }).code).toBeNull();
  });

  it('isUnavailable 只認 ChatError 的 UNAVAILABLE', () => {
    expect(isUnavailable(new ChatError('x', 'UNAVAILABLE'))).toBe(true);
    expect(isUnavailable(new ChatError('x', null))).toBe(false);
    expect(isUnavailable(new Error('x'))).toBe(false);
  });

  it('送出失敗的字：送太快有自己的說法，其餘一律「無法傳送」，不透露是被封鎖還是對方不存在', () => {
    expect(sendFailureText('RATE_LIMITED')).toBe('送太快了，稍後再試');
    for (const c of ['CANNOT_SEND', 'NOT_PARTICIPANT', 'SLOT_INVALID', null] as const) {
      expect(sendFailureText(c)).toBe('無法傳送');
    }
  });
});

describe('開啟對話失敗的分類（設計 4.6）', () => {
  const e = (c: ConstructorParameters<typeof ChatError>[1]) => new ChatError('x', c);
  it('降級、未登入、找不到店、找不到訂單各自一種', () => {
    expect(openFailure(e('UNAVAILABLE'))).toBe('unavailable');
    expect(openFailure(e('LOGIN_REQUIRED'))).toBe('login');
    expect(openFailure(e('SHOP_NOT_FOUND'))).toBe('noshop');
    expect(openFailure(e('ORDER_NOT_YOURS'))).toBe('noorder');
    expect(openFailure(e('ORDER_NOT_YOUR_SHOP'))).toBe('noorder');
  });
  it('不是參與者與對話不存在長得一樣（不透露對話是否存在）', () => {
    expect(openFailure(e('NOT_PARTICIPANT'))).toBe('noshop');
  });
  it('網路錯誤與不認得的錯誤＝可重試', () => {
    expect(openFailure(e(null))).toBe('error');
    expect(openFailure(new Error('boom'))).toBe('error');
  });
});
