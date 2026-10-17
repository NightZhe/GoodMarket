// 帳號版 RPC／購物車表的錯誤分類。supabase-js 的 error：
//   hint＝資料庫自己定的機器代碼（message 是中文，可直接顯示）；code＝PostgREST／Postgres 的代碼；
//   網路中斷、逾時沒有伺服器回應，code 是空字串或不存在。

export type AccountErrorKind =
  | 'auth'             // 沒登入或登入已失效
  | 'backend_missing'  // 資料庫還沒升級到有買家帳號功能（新前端＋舊資料庫，AC-62）
  | 'network'          // 沒有回應，可以重試
  | 'server';          // 資料庫明確拒絕（庫存不足、狀態已變…）

export class AccountError extends Error {
  readonly kind: AccountErrorKind;
  /** 資料庫的錯誤碼（hint）；沒有就是 null */
  readonly code: string | null;
  constructor(message: string, kind: AccountErrorKind, code: string | null) {
    super(message);
    this.name = 'AccountError';
    this.kind = kind;
    this.code = code;
  }
}

interface RawError { message: string; code?: string | null; hint?: string | null }

/** PGRST202＝找不到函式、PGRST205＝找不到表：M1 還沒套用。PGRST301～303＝JWT 失效。42501＝沒有權限（匿名讀購物車表） */
export function classifyAccountError(e: RawError): AccountError {
  const hint = e.hint && e.hint !== '' ? e.hint : null;
  const code = e.code && e.code !== '' ? e.code : null;
  if (hint === 'NOT_AUTHENTICATED' || code === '42501' || code === 'PGRST301' || code === 'PGRST302' || code === 'PGRST303') {
    return new AccountError(e.message, 'auth', hint);
  }
  if (code === 'PGRST202' || code === 'PGRST205') return new AccountError(e.message, 'backend_missing', hint);
  if (!code && !hint) return new AccountError(e.message, 'network', null);
  return new AccountError(e.message, 'server', hint);
}

export const toAccountError = (e: unknown): AccountError =>
  e instanceof AccountError ? e : classifyAccountError({ message: e instanceof Error ? e.message : String(e) });

/**
 * 給使用者看的文字。只有資料庫自己定的中文訊息（有 hint）才直接顯示；
 * 其餘（PostgREST 英文、網路錯誤）一律用固定的中文，不得讓英文原文出現在畫面上（R-18）。
 */
export function accountErrorText(e: unknown, fallback: string): string {
  const err = toAccountError(e);
  if (err.kind === 'network') return '連線失敗，請檢查網路後再試一次。';
  if (err.kind === 'backend_missing') return '這個功能暫時無法使用，請稍後再試。';
  if (err.kind === 'auth') return '登入已過期，請重新登入。';
  return err.code && err.message ? err.message : fallback;
}
