/** 賣家訂單操作（出貨、取消、更新物流節點）失敗時丟出的錯誤。 */
export class OrderActionError extends Error {
  /** 資料庫或 PostgREST 回的錯誤碼（P0001、42501…）；null＝沒有回應就失敗，多半是網路中斷或逾時 */
  readonly code: string | null;
  constructor(message: string, code: string | null) {
    super(message);
    this.name = 'OrderActionError';
    this.code = code;
  }
}

export const NETWORK_ERROR_MESSAGE = '連線失敗，請稍後再試';
export const UNKNOWN_ERROR_MESSAGE = '操作失敗，請稍後再試';

/**
 * 把 supabase-js 回傳的 error 包成 OrderActionError，並保留錯誤碼。
 * 網路層失敗（斷線、逾時）沒有伺服器回應，錯誤碼是空字串或不存在；
 * 它的 message 各瀏覽器不同（Failed to fetch／Load failed／NetworkError when…），所以只看錯誤碼，不比對文字。
 */
export const toOrderActionError = (error: { message: string; code?: string | null }): OrderActionError =>
  new OrderActionError(error.message, typeof error.code === 'string' && error.code !== '' ? error.code : null);

/** 給使用者看的訊息：資料庫回的是中文，直接顯示；沒有錯誤碼的當網路錯誤；其他意外錯誤用通用說法 */
export const orderActionErrorMessage = (e: unknown): string => {
  if (!(e instanceof OrderActionError)) return UNKNOWN_ERROR_MESSAGE;
  return e.code === null || e.message === '' ? NETWORK_ERROR_MESSAGE : e.message;
};
