import { describe, expect, it } from 'vitest';
import type { PaymentErrorCode } from './types';
import { PAYMENT_ERROR_TEXT, PaymentError, parseErrorBody, paymentErrorText } from './errors';

// 型別層面強迫這份清單跟 PaymentErrorCode 一樣長：後端加了新碼，這裡編譯不過
const ALL_CODES = {
  NOT_AUTHENTICATED: 1, REQUEST_INVALID: 1, RETURN_PATH_INVALID: 1, NO_CONTACT: 1, PAYMENT_DISABLED: 1, CARD_LIMIT: 1,
  BIND_RATE_LIMIT: 1, BIND_UNAVAILABLE: 1, BIND_NOT_FOUND: 1, CARD_NOT_FOUND: 1, DEFAULT_CARD_CANNOT_DELETE: 1, GROUP_NOT_FOUND: 1,
  ALREADY_PAID: 1, PAYMENT_IN_PROGRESS: 1, ORDER_EXPIRED: 1, SHOP_NOT_ONLINE: 1, ONLINE_AMOUNT_LIMIT: 1, ORDER_PAID_NO_CANCEL: 1,
  FORBIDDEN: 1, METHOD_NOT_ALLOWED: 1, INTERNAL: 1,
} satisfies Record<PaymentErrorCode, 1>;

describe('錯誤碼對照表', () => {
  it('每一個錯誤碼都有中文文字，且不含英文單字（R-18：英文原文不得出現在畫面）', () => {
    for (const code of Object.keys(ALL_CODES) as PaymentErrorCode[]) {
      const text = PAYMENT_ERROR_TEXT[code];
      expect(text, code).toBeTruthy();
      expect(text, code).not.toMatch(/[A-Za-z]{2,}/);
    }
  });
});

describe('CARD_LIMIT 的說明', () => {
  it('張數上限包含「刪除中」的卡：畫面上算有效的卡不到 5 張時，使用者也看得懂為什麼被擋', () => {
    expect(PAYMENT_ERROR_TEXT.CARD_LIMIT).toContain('刪除中');
  });
});

describe('parseErrorBody：Edge Function 的 { ok:false, error:{code,message} }', () => {
  it('標準格式', () => {
    const e = parseErrorBody({ ok: false, error: { code: 'CARD_LIMIT', message: '最多 5 張' } }, 409);
    expect(e).toBeInstanceOf(PaymentError);
    expect(e.code).toBe('CARD_LIMIT');
    expect(e.status).toBe(409);
    expect(e.kind).toBe('server');
  });
  it('401 或 NOT_AUTHENTICATED 是登入失效', () => {
    expect(parseErrorBody({ ok: false, error: { code: 'NOT_AUTHENTICATED', message: 'x' } }, 401).kind).toBe('auth');
    expect(parseErrorBody(null, 401).kind).toBe('auth');
  });
  it('看不懂的內容（不是 JSON、沒有 code）：沒有 code，當伺服器錯誤，不採用任何文字', () => {
    const e = parseErrorBody({ message: 'boom' }, 500);
    expect(e.code).toBeNull();
    expect(e.kind).toBe('server');
    expect(paymentErrorText(e, '付款失敗')).toBe('付款失敗');
  });
  it('沒見過的 code：保留代碼給程式判斷，但文字用 fallback', () => {
    const e = parseErrorBody({ ok: false, error: { code: 'BRAND_NEW', message: 'x' } }, 400);
    expect(e.code).toBe('BRAND_NEW');
    expect(paymentErrorText(e, '操作失敗')).toBe('操作失敗');
  });
});

describe('paymentErrorText', () => {
  it('網路錯誤與登入過期有固定句子', () => {
    expect(paymentErrorText(new PaymentError('x', 'network', null, null), 'f')).toBe('連線失敗，請檢查網路後再試一次。');
    expect(paymentErrorText(new PaymentError('x', 'auth', 'NOT_AUTHENTICATED', 401), 'f')).toBe('登入已過期，請重新登入。');
  });
  it('已知代碼用對照表', () => {
    expect(paymentErrorText(new PaymentError('x', 'server', 'CARD_LIMIT', 409), 'f')).toBe(PAYMENT_ERROR_TEXT.CARD_LIMIT);
  });
});
