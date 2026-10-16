import type { ReviewErrorCode } from './types';

const KNOWN: ReadonlySet<string> = new Set<ReviewErrorCode>([
  'ORDER_NOT_FOUND', 'ORDER_NOT_COMPLETED', 'REVIEW_EXPIRED', 'EMPTY_SUBMISSION', 'ITEM_INVALID',
  'PRODUCT_NOT_IN_ORDER', 'ALREADY_REVIEWED', 'DUPLICATE_ITEM', 'RATING_INVALID',
  'CONTENT_TOO_LONG', 'NICKNAME_INVALID', 'PHOTO_TOO_MANY', 'PHOTO_INVALID', 'UPLOAD_EXPIRED',
  'UPLOAD_COUNT_INVALID', 'UPLOAD_LIMIT_EXCEEDED',
  'NOT_AUTHENTICATED', 'NO_SHOP', 'TAB_INVALID', 'REVIEW_NOT_FOUND', 'REVIEW_HIDDEN', 'REPLY_INVALID',
]);

/** 資料庫的錯誤碼放在 error.hint；不認得的 hint（例如 PostgREST 自己的提示）一律當成沒有錯誤碼 */
export const toErrorCode = (hint: unknown): ReviewErrorCode | null =>
  typeof hint === 'string' && KNOWN.has(hint) ? (hint as ReviewErrorCode) : null;

export class ReviewError extends Error {
  /** null＝沒有資料庫錯誤碼，多半是網路中斷或逾時，可以重試 */
  readonly code: ReviewErrorCode | null;
  constructor(message: string, code: ReviewErrorCode | null) {
    super(message);
    this.name = 'ReviewError';
    this.code = code;
  }
}

export const NICKNAME_HINT_ERROR = '暱稱需為 2–12 個字，只能用中英文、數字、_ 和 -';

const SUBMIT_MESSAGES: Partial<Record<ReviewErrorCode, string>> = {
  ORDER_NOT_FOUND: '找不到這筆訂單',
  ORDER_NOT_COMPLETED: '訂單完成後才能評價',
  REVIEW_EXPIRED: '評價期限已過，這批評價沒有送出',
  ALREADY_REVIEWED: '這件商品已經評價過了。這批評價沒有送出，已評價的商品會移到下方，請確認後再送出一次',
  PRODUCT_NOT_IN_ORDER: '資料有誤，請重新整理',
  DUPLICATE_ITEM: '資料有誤，請重新整理',
  ITEM_INVALID: '資料有誤，請重新整理',
  RATING_INVALID: '請選擇 1 到 5 顆星',
  CONTENT_TOO_LONG: '評價內容最多 500 字',
  NICKNAME_INVALID: NICKNAME_HINT_ERROR,
  EMPTY_SUBMISSION: '請至少評價一件商品',
  PHOTO_TOO_MANY: '每則評價最多 5 張照片',
  PHOTO_INVALID: '照片上傳不完整，請重新上傳',
  UPLOAD_LIMIT_EXCEEDED: '照片上傳次數已達上限',
  UPLOAD_COUNT_INVALID: '每則評價最多 5 張照片',
  UPLOAD_EXPIRED: '照片上傳逾時，請重新上傳',
};

export const SUBMIT_FALLBACK = '送出失敗，請稍後再試。你填的內容和照片都還在。';

export const submitErrorMessage = (code: ReviewErrorCode | null): string =>
  (code && SUBMIT_MESSAGES[code]) || SUBMIT_FALLBACK;

const REPLY_MESSAGES: Partial<Record<ReviewErrorCode, string>> = {
  REPLY_INVALID: '回覆需為 1 到 500 字',
  REVIEW_HIDDEN: '這則評價已被平台隱藏，無法回覆',
  REVIEW_NOT_FOUND: '找不到這則評價',
  NOT_AUTHENTICATED: '登入已逾時，請重新登入',
  NO_SHOP: '你還沒有開店',
};

export const REPLY_FALLBACK = '回覆送出失敗，請檢查網路後再試一次。你輸入的內容還在。';

export const replyErrorMessage = (code: ReviewErrorCode | null): string =>
  (code && REPLY_MESSAGES[code]) || REPLY_FALLBACK;

/** 這些錯誤代表「這張訂單的狀態跟畫面上看到的不一樣了」，需要重新取得狀態 */
export const needsStatusRefresh = (code: ReviewErrorCode | null): boolean =>
  code === 'REVIEW_EXPIRED' || code === 'ALREADY_REVIEWED' || code === 'ORDER_NOT_COMPLETED' || code === 'ORDER_NOT_FOUND';
