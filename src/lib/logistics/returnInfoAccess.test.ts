import { describe, expect, it } from 'vitest';
import { AccountError } from '../account/errors';
import { hasReturnInfoEntry, returnInfoFailure, returnInfoRetryable } from './returnInfoAccess';

describe('退貨資訊入口（D9、AC-L30）', () => {
  it('運送中、已完成有入口；待出貨、已取消沒有', () => {
    expect(hasReturnInfoEntry('shipping')).toBe(true);
    expect(hasReturnInfoEntry('completed')).toBe(true);
    expect(hasReturnInfoEntry('to_ship')).toBe(false);
    expect(hasReturnInfoEntry('cancelled')).toBe(false);
  });
});

describe('退貨資訊讀取失敗的分類（設計 6.4、N6）', () => {
  it('函式不存在（舊資料庫）＝unavailable', () => {
    expect(returnInfoFailure(new AccountError('x', 'backend_missing', null))).toBe('unavailable');
  });
  it('資料庫的三個錯誤碼', () => {
    expect(returnInfoFailure(new AccountError('x', 'server', 'RETURN_INFO_NOT_AVAILABLE'))).toBe('not_available');
    expect(returnInfoFailure(new AccountError('x', 'server', 'ORDER_NOT_FOUND'))).toBe('not_found');
    expect(returnInfoFailure(new AccountError('請先登入', 'auth', 'NOT_AUTHENTICATED'))).toBe('auth');
  });
  it('網路中斷與其他伺服器錯誤＝failed（可重試，不講成賣家沒設）', () => {
    expect(returnInfoFailure(new AccountError('Failed to fetch', 'network', null))).toBe('failed');
    expect(returnInfoFailure(new AccountError('boom', 'server', 'SOMETHING_ELSE'))).toBe('failed');
    expect(returnInfoFailure(new Error('TypeError: network'))).toBe('failed');
    expect(returnInfoFailure(undefined)).toBe('failed');
  });
  it('只有離線與失敗可以重試', () => {
    expect(returnInfoRetryable('offline')).toBe(true);
    expect(returnInfoRetryable('failed')).toBe(true);
    for (const f of ['unavailable', 'not_available', 'not_found', 'auth'] as const) expect(returnInfoRetryable(f)).toBe(false);
  });
});
