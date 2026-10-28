import { afterEach, describe, expect, it } from 'vitest';
import { clearBankDone, peekBankDone, setBankDone } from './bankDone';

afterEach(clearBankDone);

describe('bankDone：流程頁交給頁 A 的完成訊息', () => {
  it('設了才有，讀不會清，清了就沒有', () => {
    expect(peekBankDone()).toBeNull();
    setBankDone({ toast: '已新增銀行帳號', focusId: 'a1' });
    expect(peekBankDone()).toEqual({ toast: '已新增銀行帳號', focusId: 'a1' });
    expect(peekBankDone()).not.toBeNull();
    clearBankDone();
    expect(peekBankDone()).toBeNull();
  });
});
