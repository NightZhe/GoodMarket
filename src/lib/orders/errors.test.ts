import { describe, expect, it } from 'vitest';
import { NETWORK_ERROR_MESSAGE, OrderActionError, UNKNOWN_ERROR_MESSAGE, orderActionErrorMessage, toOrderActionError } from './errors';

const show = (message: string, code?: string | null) => orderActionErrorMessage(toOrderActionError({ message, code }));

describe('orderActionErrorMessage', () => {
  it('各瀏覽器的斷線訊息都顯示中文（supabase-js 的網路錯誤 code 是空字串）', () => {
    expect(show('TypeError: Failed to fetch', '')).toBe(NETWORK_ERROR_MESSAGE);                         // Chrome
    expect(show('TypeError: Load failed', '')).toBe(NETWORK_ERROR_MESSAGE);                             // WebKit（iPhone 所有瀏覽器）
    expect(show('TypeError: NetworkError when attempting to fetch resource.', '')).toBe(NETWORK_ERROR_MESSAGE); // Firefox
  });

  it('錯誤碼不存在（undefined／null）也當網路錯誤', () => {
    expect(show('TypeError: Load failed')).toBe(NETWORK_ERROR_MESSAGE);
    expect(show('TypeError: Load failed', null)).toBe(NETWORK_ERROR_MESSAGE);
  });

  it('有錯誤碼的資料庫錯誤，直接顯示資料庫回的中文訊息', () => {
    expect(show('只有運送中的訂單可以更新物流進度', 'P0001')).toBe('只有運送中的訂單可以更新物流進度');
    expect(show('找不到訂單，或你不是這家店的店主', '42501')).toBe('找不到訂單，或你不是這家店的店主');
  });

  it('資料庫錯誤即使訊息裡剛好有 fetch／network 字樣，也照原文顯示（不比對文字）', () => {
    expect(show('failed to fetch row', 'P0001')).toBe('failed to fetch row');
  });

  it('不是 OrderActionError 的意外錯誤用通用說法，不洩漏原始訊息', () => {
    expect(orderActionErrorMessage(new TypeError('x is undefined'))).toBe(UNKNOWN_ERROR_MESSAGE);
    expect(orderActionErrorMessage('boom')).toBe(UNKNOWN_ERROR_MESSAGE);
  });

  it('toOrderActionError 保留錯誤碼', () => {
    expect(toOrderActionError({ message: 'm', code: 'P0001' })).toBeInstanceOf(OrderActionError);
    expect(toOrderActionError({ message: 'm', code: 'P0001' }).code).toBe('P0001');
    expect(toOrderActionError({ message: 'm', code: '' }).code).toBeNull();
  });
});
