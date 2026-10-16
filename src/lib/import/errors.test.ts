import { describe, expect, it } from 'vitest';
import { ImportCallError, callErrorExplanation, toCallError } from './errors';

describe('toCallError', () => {
  it('hint 是已知的呼叫層代碼 → 不可重試', () => {
    const e = toCallError({ message: '匯入已結束', hint: 'IMPORT_CLOSED' });
    expect(e).toBeInstanceOf(ImportCallError);
    expect(e.code).toBe('IMPORT_CLOSED');
    expect(e.retryable).toBe(false);
  });

  it('JWT 過期視為未登入', () => {
    expect(toCallError({ message: 'JWT expired', code: 'PGRST301' }).code).toBe('NOT_AUTHENTICATED');
    expect(toCallError({ message: 'JWT expired' }).code).toBe('NOT_AUTHENTICATED');
  });

  it('網路錯誤、未知 hint → 可重試', () => {
    expect(toCallError({ message: 'TypeError: Failed to fetch', hint: '' }).retryable).toBe(true);
    expect(toCallError({ message: 'boom', hint: 'SOMETHING_ELSE' }).retryable).toBe(true);
  });

  it('每個呼叫層代碼都有白話說明', () => {
    for (const c of ['NOT_AUTHENTICATED', 'NO_SHOP', 'INVALID_PAYLOAD', 'IMPORT_LIMIT_EXCEEDED',
      'BATCH_TOO_LARGE', 'IMPORT_NOT_FOUND', 'IMPORT_CLOSED'] as const) {
      expect(callErrorExplanation(c).length).toBeGreaterThan(5);
    }
  });
});
