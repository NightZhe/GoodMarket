import type { PaymentErrorCode } from './types';

// Edge Function 的錯誤：HTTP 4xx／5xx，body 是 { ok:false, error:{ code, message } }（介面文件第 0 節第 5 點）。
// 畫面上的文字一律用下面這張表（固定中文），不直接顯示伺服器給的 message，更不會出現英文原文（R-18）。

export type PaymentErrorKind = 'auth' | 'network' | 'server';

export class PaymentError extends Error {
  readonly kind: PaymentErrorKind;
  /** 伺服器的錯誤碼；沒有（網路中斷、看不懂的回應）就是 null。可能是沒見過的新碼，所以型別是 string */
  readonly code: PaymentErrorCode | (string & {}) | null;
  readonly status: number | null;
  constructor(message: string, kind: PaymentErrorKind, code: string | null, status: number | null) {
    super(message);
    this.name = 'PaymentError';
    this.kind = kind;
    this.code = code;
    this.status = status;
  }
}

export const PAYMENT_ERROR_TEXT: Record<PaymentErrorCode, string> = {
  NOT_AUTHENTICATED: '登入已過期，請重新登入。',
  REQUEST_INVALID: '資料有誤，請重新整理後再試一次。',
  RETURN_PATH_INVALID: '資料有誤，請重新整理後再試一次。',
  NO_CONTACT: '你的帳號沒有電子郵件或手機號碼，綠界科技無法受理。請先綁定手機。',
  PAYMENT_DISABLED: '線上付款暫時停用，目前只能貨到付款。',
  CARD_LIMIT: '信用卡最多只能綁 5 張，正在刪除中的卡也算在內。請先刪除一張，或等刪除中的卡處理完再試。',
  BIND_RATE_LIMIT: '嘗試的次數太多了，請一小時後再試。',
  BIND_UNAVAILABLE: '暫時連不上綠界科技，請稍後再試。',
  BIND_NOT_FOUND: '找不到這次綁定，請重新開始。',
  CARD_NOT_FOUND: '這張卡已經被刪除。',
  DEFAULT_CARD_CANNOT_DELETE: '預設的卡不能直接刪除，請先把別張設為預設。',
  GROUP_NOT_FOUND: '找不到這筆付款。',
  ALREADY_PAID: '這筆訂單已經付款了。',
  PAYMENT_IN_PROGRESS: '這筆付款正在處理中，請稍候，不要重複付款。',
  ORDER_EXPIRED: '付款已逾時，訂單已取消，請重新下單。',
  SHOP_NOT_ONLINE: '有商店目前不能線上付款，請重新整理後再試。',
  ONLINE_AMOUNT_LIMIT: '單一商店的線上付款金額上限是 $200,000，請改用貨到付款。',
  ORDER_PAID_NO_CANCEL: '這筆訂單已經付款，目前無法自行取消。',
  FORBIDDEN: '沒有權限執行這個動作。',
  METHOD_NOT_ALLOWED: '系統忙碌，請稍後再試。',
  INTERNAL: '系統忙碌，請稍後再試。',
};

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;

/** 把非 2xx 的回應內容（可能不是我們的格式）轉成 PaymentError。401 或 NOT_AUTHENTICATED＝登入失效 */
export function parseErrorBody(body: unknown, status: number | null): PaymentError {
  const err = isObj(body) && isObj(body.error) ? body.error : null;
  const code = err && typeof err.code === 'string' ? err.code : null;
  const message = err && typeof err.message === 'string' ? err.message : `HTTP ${status ?? '?'}`;
  const auth = status === 401 || code === 'NOT_AUTHENTICATED';
  return new PaymentError(message, auth ? 'auth' : 'server', code, status);
}

/** 給使用者看的文字：網路、登入有固定句子；已知代碼查表；其餘用呼叫端的 fallback */
export function paymentErrorText(e: PaymentError, fallback: string): string {
  if (e.kind === 'network') return '連線失敗，請檢查網路後再試一次。';
  if (e.kind === 'auth') return PAYMENT_ERROR_TEXT.NOT_AUTHENTICATED;
  return (e.code && (PAYMENT_ERROR_TEXT as Record<string, string>)[e.code]) || fallback;
}
