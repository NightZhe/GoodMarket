import { describe, expect, it } from 'vitest';
import { ChatError, isMissingFunction, isUnavailable, openFailure, sendFailureText, summaryFailure, toChatError, toErrorCode } from './errors';
import { nextAvailability } from './nav';

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
  it('網路錯誤（沒有資料庫錯誤碼、逾時）＝離線型失敗，不是「無法開啟對話」（AC-M24）', () => {
    expect(openFailure(e(null))).toBe('offline');
  });
  it('不認得的非聊聊錯誤＝一般錯誤，可重試', () => {
    expect(openFailure(new Error('boom'))).toBe('error');
    expect(openFailure(e('CANNOT_SEND'))).toBe('error');
  });
});

describe('未讀摘要讀取失敗的分類（R-M24：只有確認降級才藏入口）', () => {
  it('RPC 不存在＝降級；未登入＝函式存在（遊客）；其他（斷網、逾時）＝暫時的', () => {
    expect(summaryFailure(new ChatError('x', 'UNAVAILABLE'))).toBe('degraded');
    expect(summaryFailure(new ChatError('x', 'LOGIN_REQUIRED'))).toBe('guest');
    expect(summaryFailure(new ChatError('x', null))).toBe('transient');
    expect(summaryFailure(new Error('Failed to fetch'))).toBe('transient');
  });
  it('第一次讀就遇到網路錯誤：入口視為可用（鈕顯示、角標暫不顯示）；已確認降級的不會被網路錯誤翻回來', () => {
    expect(nextAvailability('unknown', 'transient')).toBe('ok');
    expect(nextAvailability('ok', 'transient')).toBe('ok');
    expect(nextAvailability('unavailable', 'transient')).toBe('unavailable');
    expect(nextAvailability('unknown', 'degraded')).toBe('unavailable');
    expect(nextAvailability('unknown', 'guest')).toBe('ok');
  });
});
