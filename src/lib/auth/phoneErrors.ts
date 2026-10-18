import type { InAppKind } from './inapp';

// 手機登入／綁定的錯誤對照（R-12）。判斷只看 error.name／status／code，不比對英文訊息；
// 唯一的例外是 over_sms_send_rate_limit 的輔助判斷（見下），而且英文原文絕不顯示。
// 對照表來源：.work/phone-otp-auth/t2-local-tests.md 第 3 節（GoTrue v2.197.0、auth-js 2.117.2 實測）。

/** supabase-js 的 AuthError 的結構型別：不 import supabase，才測得到 */
export interface AuthErrorLike { name?: string; status?: number; code?: string; message?: string }

export type PhoneErrorKind =
  | 'invalid_phone'       // validation_failed（門號格式，前端漏擋）
  | 'code_empty'          // validation_failed（驗證碼是空字串）
  | 'otp_invalid'         // otp_expired：錯、過期、被重寄取代、門號不存在，分不出來
  | 'rate_limit_resend'   // over_sms_send_rate_limit：同一門號 60 秒內
  | 'rate_limit_site'     // over_sms_send_rate_limit：全站每小時額度用完
  | 'rate_limit_ip'       // over_request_rate_limit、其他 429
  | 'sms_failed'          // sms_send_failed
  | 'phone_exists'        // 綁定：這支手機已是另一個帳號
  | 'provider_disabled'   // phone_provider_disabled
  | 'signup_disabled'     // signup_disabled、otp_disabled
  | 'captcha_failed'      // captcha_failed
  | 'network'             // AuthRetryableFetchError，status 0：離線、連不上
  | 'timeout'             // request_timeout
  | 'server'              // AuthRetryableFetchError，status ≥ 500（例：Supabase 連不到 Cloudflare 驗證）
  | 'session_missing'     // AuthSessionMissingError：沒登入就綁定
  | 'unknown';

export interface PhoneErrorContext {
  now: number;
  /** 這個門號上一次成功傳送的時間（前端記得的）；不知道就不給 */
  lastSentAt?: number | null;
  /** verify：驗證碼步驟（validation_failed 代表驗證碼空白） */
  op?: 'send' | 'verify';
}

/** 同一門號重寄間隔（伺服器 max_frequency 也是 60 秒，R-14 第 2 點） */
export const RESEND_WINDOW_MS = 60_000;

export function classifyPhoneError(e: AuthErrorLike, ctx: PhoneErrorContext): { kind: PhoneErrorKind } {
  const kind = ((): PhoneErrorKind => {
    // 同名不同事：status 0＝離線，≥500＝伺服器錯（Captcha 驗證流程失敗也是這個）
    if (e.name === 'AuthRetryableFetchError') return (e.status ?? 0) === 0 ? 'network' : 'server';
    if (e.name === 'AuthSessionMissingError') return 'session_missing';
    switch (e.code) {
      case 'validation_failed': return ctx.op === 'verify' ? 'code_empty' : 'invalid_phone';
      case 'otp_expired': return 'otp_invalid';
      case 'over_sms_send_rate_limit': return isResendWindow(e, ctx) ? 'rate_limit_resend' : 'rate_limit_site';
      case 'over_request_rate_limit': return 'rate_limit_ip';
      case 'sms_send_failed': return 'sms_failed';
      case 'phone_exists': return 'phone_exists';
      case 'phone_provider_disabled': return 'provider_disabled';
      case 'signup_disabled':
      case 'otp_disabled': return 'signup_disabled';
      case 'captcha_failed': return 'captcha_failed';
      case 'request_timeout': return 'timeout';
    }
    return e.status === 429 ? 'rate_limit_ip' : 'unknown';
  })();
  return { kind };
}

/**
 * 同一個 code 的兩種意思。主要依據：這個門號距上次傳送是否不到 60 秒（前端自己記得的）。
 * 前端不知道上次傳送時間時（換分頁、換裝置），才用伺服器訊息的開頭當輔助——那是英文固定字串、
 * 沒有保證不變，所以只做判斷、不顯示，判斷錯了的後果只是講成另一句溫和的「請稍後再試」。
 */
function isResendWindow(e: AuthErrorLike, ctx: PhoneErrorContext): boolean {
  if (ctx.lastSentAt != null) return ctx.now - ctx.lastSentAt < RESEND_WINDOW_MS;
  return /^For security purposes/i.test(e.message ?? '');
}

export interface PhoneErrorView {
  kind: 'error' | 'warning';
  title: string;
  body?: string;
}

/** 「改用 Apple／Google 登入」在內建瀏覽器裡做不到（Google 擋 WebView），換成外開瀏覽器的說法 */
function altLogin(c: { inApp?: InAppKind | null; ios?: boolean }): string {
  if (!c.inApp) return '改用 Apple／Google 登入';
  return `用${c.inApp === 'line' && c.ios ? ' Safari ' : '瀏覽器'}開啟後改用 Apple／Google 登入`;
}

/** 畫面文字，逐字照 design.md 第 6 節。title 是橫幅標題；沒有 body 的整句放 title */
export function phoneErrorView(kind: PhoneErrorKind, c: { inApp?: InAppKind | null; ios?: boolean } = {}): PhoneErrorView {
  switch (kind) {
    case 'invalid_phone': return { kind: 'error', title: '手機號碼格式不正確。' };
    case 'code_empty': return { kind: 'error', title: '請輸入驗證碼' };
    case 'otp_invalid': return { kind: 'error', title: '驗證碼不正確或已過期，請輸入最新一則簡訊的驗證碼，或重新傳送。' };
    case 'rate_limit_resend': return { kind: 'warning', title: '剛剛已經傳送過', body: '請稍等一下再重新傳送；收到的驗證碼仍然可以用。' };
    case 'rate_limit_site': return { kind: 'warning', title: '目前簡訊傳送量太大', body: `請過一段時間再試，或${altLogin(c)}。` };
    case 'rate_limit_ip': return { kind: 'error', title: '嘗試次數太多，請稍等一下再試。' };
    case 'sms_failed': return { kind: 'error', title: '簡訊沒有送出', body: `請確認手機號碼，稍後再試，或${altLogin(c)}。` };
    case 'phone_exists': return {
      kind: 'error', title: '這支手機已經用來登入另一個好物集帳號，不能綁到這裡。',
      body: '你可以改綁另一支手機。如果想把這支手機留給目前的帳號，請來信，我們協助處理。',
    };
    case 'provider_disabled': return { kind: 'error', title: '目前暫停手機登入，請改用 Apple 或 Google。' };
    case 'signup_disabled': return { kind: 'error', title: '目前暫停新帳號註冊，已經有帳號的人請改用原本的方式登入。' };
    case 'captcha_failed': return { kind: 'warning', title: '安全驗證已失效，請再按一次傳送驗證碼。' };
    case 'network': return { kind: 'error', title: '連不上伺服器，請檢查網路後再試。' };
    case 'timeout': return { kind: 'error', title: '伺服器回應太慢，請再試一次。' };
    case 'session_missing': return { kind: 'error', title: '登入已過期，請重新登入後再試。' };
    case 'server':
    case 'unknown': return { kind: 'error', title: '沒有完成，請再試一次。' };
  }
}
