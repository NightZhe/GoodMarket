// 聊聊 RPC 的錯誤：資料庫的錯誤碼放在 error.hint（沿用評價／物流）。
// 兩件事要特別分開：
//   - code null＝沒有資料庫錯誤碼，多半是網路中斷或逾時，可以重試
//   - UNAVAILABLE＝資料庫還沒升級（RPC 不存在），聊聊整個降級（R-M24）

export type ChatErrorCode =
  | 'LOGIN_REQUIRED' | 'BAD_ARGS' | 'NOT_PARTICIPANT' | 'NOT_BUYER_SIDE' | 'NOT_BLOCKER'
  | 'CANNOT_SEND' | 'TEXT_TOO_LONG' | 'EMPTY_MESSAGE' | 'PHOTO_LIMIT' | 'SLOT_INVALID'
  | 'CARD_INVALID' | 'PRODUCT_NOT_IN_SHOP' | 'ORDER_NOT_YOURS' | 'ORDER_NOT_YOUR_SHOP'
  | 'RATE_LIMITED' | 'SHOP_IS_OWN' | 'SHOP_NOT_FOUND'
  | 'UNAVAILABLE';

const KNOWN: ReadonlySet<string> = new Set<ChatErrorCode>([
  'LOGIN_REQUIRED', 'BAD_ARGS', 'NOT_PARTICIPANT', 'NOT_BUYER_SIDE', 'NOT_BLOCKER',
  'CANNOT_SEND', 'TEXT_TOO_LONG', 'EMPTY_MESSAGE', 'PHOTO_LIMIT', 'SLOT_INVALID',
  'CARD_INVALID', 'PRODUCT_NOT_IN_SHOP', 'ORDER_NOT_YOURS', 'ORDER_NOT_YOUR_SHOP',
  'RATE_LIMITED', 'SHOP_IS_OWN', 'SHOP_NOT_FOUND',
]);

/** 資料庫的 hint → 錯誤碼；不認得的 hint（例如 PostgREST 自己的提示）一律當成沒有錯誤碼 */
export const toErrorCode = (hint: unknown): ChatErrorCode | null =>
  typeof hint === 'string' && KNOWN.has(hint) ? (hint as ChatErrorCode) : null;

export interface RpcErrorLike { message?: string; code?: string; hint?: string | null; status?: number }

/**
 * 函式不存在（資料庫沒套新 migration）：PostgREST 回 PGRST202（找不到函式）、Postgres 42883（undefined_function），
 * 或整個端點 404。參數對不上也是 PGRST202，但本模組的簽名是固定的，所以不會因此誤判
 */
export function isMissingFunction(e: RpcErrorLike | null | undefined): boolean {
  if (!e) return false;
  return e.code === 'PGRST202' || e.code === '42883' || e.status === 404;
}

export class ChatError extends Error {
  /** null＝沒有資料庫錯誤碼，多半是網路中斷或逾時，可以重試 */
  readonly code: ChatErrorCode | null;
  constructor(message: string, code: ChatErrorCode | null) {
    super(message);
    this.name = 'ChatError';
    this.code = code;
  }
}

export function toChatError(e: RpcErrorLike): ChatError {
  if (isMissingFunction(e)) return new ChatError(e.message ?? '聊聊尚未啟用', 'UNAVAILABLE');
  return new ChatError(e.message ?? '聊聊暫時無法使用', toErrorCode(e.hint));
}

export const errorCodeOf = (e: unknown): ChatErrorCode | null => (e instanceof ChatError ? e.code : null);

export const isUnavailable = (e: unknown): boolean => e instanceof ChatError && e.code === 'UNAVAILABLE';

/** 送出失敗時，訊息下方那一行字（§10.3）：送太快有自己的說法，其餘（封鎖、對方不存在、斷網…）一律「無法傳送」，不透露原因 */
export function sendFailureText(code: ChatErrorCode | null): string {
  return code === 'RATE_LIMITED' ? '送太快了，稍後再試' : '無法傳送';
}

/** 開啟對話失敗時整頁要顯示哪一種（設計 4.6）。對話不存在與非參與者一律同一種，不透露對話是否存在 */
export type OpenFailure = 'unavailable' | 'login' | 'noshop' | 'noorder' | 'error';

export function openFailure(e: unknown): OpenFailure {
  if (isUnavailable(e)) return 'unavailable';
  switch (errorCodeOf(e)) {
    case 'LOGIN_REQUIRED': return 'login';
    case 'SHOP_NOT_FOUND': case 'SHOP_IS_OWN': case 'PRODUCT_NOT_IN_SHOP': case 'NOT_PARTICIPANT': return 'noshop';
    case 'ORDER_NOT_YOURS': case 'ORDER_NOT_YOUR_SHOP': case 'BAD_ARGS': return 'noorder';
    default: return 'error';
  }
}
