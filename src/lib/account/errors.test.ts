import { describe, expect, it } from 'vitest';
import { AccountError, accountErrorText, classifyAccountError, toAccountError } from './errors';

describe('classifyAccountError', () => {
  it('沒登入／登入失效：資料庫的 NOT_AUTHENTICATED、購物車表的 42501、JWT 失效', () => {
    expect(classifyAccountError({ message: '請先登入', code: 'P0001', hint: 'NOT_AUTHENTICATED' }).kind).toBe('auth');
    expect(classifyAccountError({ message: 'permission denied for table cart_items', code: '42501' }).kind).toBe('auth');
    expect(classifyAccountError({ message: 'JWT expired', code: 'PGRST301' }).kind).toBe('auth');
  });
  it('資料庫還沒升級：PGRST202（找不到函式）、PGRST205（找不到表）→ 降級', () => {
    expect(classifyAccountError({ message: 'Could not find the function', code: 'PGRST202' }).kind).toBe('backend_missing');
    expect(classifyAccountError({ message: "Could not find the table 'public.cart_items'", code: 'PGRST205' }).kind).toBe('backend_missing');
  });
  it('沒有回應（斷線、逾時）：code 與 hint 都是空的', () => {
    expect(classifyAccountError({ message: 'Failed to fetch', code: '', hint: '' }).kind).toBe('network');
    expect(classifyAccountError({ message: 'Load failed' }).kind).toBe('network');
  });
  it('資料庫明確拒絕：保留機器代碼', () => {
    const e = classifyAccountError({ message: '庫存不足', code: 'P0001', hint: 'OUT_OF_STOCK' });
    expect(e.kind).toBe('server');
    expect(e.code).toBe('OUT_OF_STOCK');
  });
  it('toAccountError 不會重複包裝；其他例外當網路錯誤', () => {
    const e = new AccountError('x', 'server', 'A');
    expect(toAccountError(e)).toBe(e);
    expect(toAccountError(new TypeError('fetch failed')).kind).toBe('network');
  });
});

describe('accountErrorText：畫面上不出現英文原文（R-18）', () => {
  it('資料庫自己的中文訊息直接顯示', () => expect(accountErrorText(classifyAccountError({ message: '這個規格目前沒有庫存', code: 'P0001', hint: 'OUT_OF_STOCK' }), 'x')).toBe('這個規格目前沒有庫存'));
  it('PostgREST 的英文錯誤改用固定中文', () => {
    const t = accountErrorText(classifyAccountError({ message: 'new row violates check constraint', code: '23514' }), '更新失敗');
    expect(t).toBe('更新失敗');
  });
  it('斷線、後端未升級、登入失效各有固定說法', () => {
    expect(accountErrorText(classifyAccountError({ message: 'Failed to fetch' }), 'x')).toMatch(/網路/);
    expect(accountErrorText(classifyAccountError({ message: 'x', code: 'PGRST202' }), 'x')).toMatch(/暫時無法使用/);
    expect(accountErrorText(classifyAccountError({ message: 'x', code: '42501' }), 'x')).toMatch(/登入已過期/);
  });
});
