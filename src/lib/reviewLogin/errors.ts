import { CONTACT_EMAIL } from '../site';

// 審查登入的錯誤對照（spec §10.2）。判斷只看 error.code／name／status，不比對英文訊息；英文原文絕不顯示（AC-X5）。

/** supabase-js AuthError 的結構型別：不 import supabase，才測得到 */
export interface ReviewLoginErrorLike { name?: string; status?: number; code?: string; message?: string }

export type ReviewLoginErrorKind =
  | 'invalid_credentials'
  | 'provider_disabled'
  | 'captcha_failed'
  | 'rate_limit'
  | 'network'
  | 'other';

export function classifyReviewLoginError(e: ReviewLoginErrorLike): ReviewLoginErrorKind {
  // 離線（AuthRetryableFetchError，status 0）；5xx 同名但是伺服器錯，歸「其他」
  if (e.name === 'AuthRetryableFetchError' && (e.status ?? 0) === 0) return 'network';
  switch (e.code) {
    case 'invalid_credentials': return 'invalid_credentials';
    case 'email_provider_disabled': return 'provider_disabled';
    case 'captcha_failed': return 'captcha_failed';
    case 'over_request_rate_limit': return 'rate_limit';
    case 'request_timeout': return 'network';
  }
  return e.status === 429 ? 'rate_limit' : 'other';
}

export interface BilingualText { zh: string; en: string }

/** offline＝按登入時瀏覽器明確離線，沒有送出 */
export function reviewLoginErrorText(kind: ReviewLoginErrorKind | 'offline'): BilingualText {
  switch (kind) {
    case 'invalid_credentials': return { zh: '帳號或密碼不正確。', en: 'Incorrect email or password.' };
    case 'provider_disabled': return { zh: `這個登入方式目前已關閉，請來信 ${CONTACT_EMAIL}。`, en: 'Email sign-in is disabled.' };
    case 'captcha_failed': return { zh: '安全驗證沒有通過，請重新整理頁面後再試。', en: 'Security check failed, please reload.' };
    case 'rate_limit': return { zh: '嘗試太多次，請過幾分鐘再試。', en: 'Too many attempts, try again later.' };
    case 'network': return { zh: '連線失敗，請檢查網路後再試一次。', en: 'Network error.' };
    case 'other': return { zh: '登入失敗，請稍後再試。', en: 'Sign-in failed.' };
    case 'offline': return { zh: '連上網路後才能登入', en: 'You are offline.' };
  }
}
