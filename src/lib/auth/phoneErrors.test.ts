import { describe, expect, it } from 'vitest';
import { classifyPhoneError, phoneErrorView, type AuthErrorLike, type PhoneErrorKind } from './phoneErrors';

const api = (status: number, code: string, message = 'x'): AuthErrorLike => ({ name: 'AuthApiError', status, code, message });
const NOW = 1_000_000;

describe('錯誤對照：依 t2-local-tests 第 3 節，用 code／name／status，不比對英文', () => {
  const cases: [string, AuthErrorLike, PhoneErrorKind][] = [
    ['格式錯', api(400, 'validation_failed'), 'invalid_phone'],
    ['驗證碼錯／過期／被重寄取代', api(403, 'otp_expired'), 'otp_invalid'],
    ['同一 IP 太多次', api(429, 'over_request_rate_limit'), 'rate_limit_ip'],
    ['其他 HTTP 429', api(429, ''), 'rate_limit_ip'],
    ['簡訊供應商拒絕', api(422, 'sms_send_failed', 'Error sending confirmation code to provider: code 21408'), 'sms_failed'],
    ['綁定：手機已是別的帳號', api(422, 'phone_exists'), 'phone_exists'],
    ['手機登入關閉', api(400, 'phone_provider_disabled'), 'provider_disabled'],
    ['關閉註冊', api(422, 'signup_disabled'), 'signup_disabled'],
    ['otp 不允許註冊', api(422, 'otp_disabled'), 'signup_disabled'],
    ['安全驗證失敗', api(400, 'captcha_failed'), 'captcha_failed'],
    ['逾時', api(504, 'request_timeout'), 'timeout'],
    ['沒登入就綁定', { name: 'AuthSessionMissingError', status: 400, message: 'Auth session missing!' }, 'session_missing'],
    ['沒有 code 的未知錯誤', api(400, 'something_new'), 'unknown'],
    ['完全空的錯誤', {}, 'unknown'],
  ];
  it.each(cases)('%s', (_label, err, kind) => {
    expect(classifyPhoneError(err, { now: NOW }).kind).toBe(kind);
  });

  it('離線（status 0）與伺服器錯（≥500）分開', () => {
    expect(classifyPhoneError({ name: 'AuthRetryableFetchError', status: 0, message: 'Failed to fetch' }, { now: NOW }).kind).toBe('network');
    expect(classifyPhoneError({ name: 'AuthRetryableFetchError', status: 500, message: 'captcha verification process failed' }, { now: NOW }).kind).toBe('server');
    expect(classifyPhoneError({ name: 'AuthRetryableFetchError', status: 503 }, { now: NOW }).kind).toBe('server');
  });

  it('驗證碼空字串（verify 的 validation_failed）是請輸入驗證碼，不是門號格式', () => {
    expect(classifyPhoneError(api(400, 'validation_failed'), { now: NOW, op: 'verify' }).kind).toBe('code_empty');
  });

  it('不看英文訊息：訊息寫什麼都不影響結果', () => {
    expect(classifyPhoneError(api(403, 'otp_expired', 'Invalid login credentials'), { now: NOW }).kind).toBe('otp_invalid');
  });
});

describe('簡訊供應端失敗（AC-M41）：只在送出驗證碼階段認得', () => {
  const send = { now: NOW, op: 'send' as const };
  const verify = { now: NOW, op: 'verify' as const };
  const retryable502: AuthErrorLike = { name: 'AuthRetryableFetchError', status: 502, message: 'x' };

  it('status 502（不論 name）→ sms_failed', () => {
    expect(classifyPhoneError(retryable502, send).kind).toBe('sms_failed');
    expect(classifyPhoneError(api(502, ''), send).kind).toBe('sms_failed');
    expect(classifyPhoneError({ status: 502 }, send).kind).toBe('sms_failed');
  });
  it('code hook_timeout（422）→ sms_failed', () => {
    expect(classifyPhoneError(api(422, 'hook_timeout'), send).kind).toBe('sms_failed');
  });
  it('code hook_timeout_after_retry（500 或 422）→ sms_failed', () => {
    expect(classifyPhoneError(api(422, 'hook_timeout_after_retry'), send).kind).toBe('sms_failed');
    expect(classifyPhoneError(api(500, 'hook_timeout_after_retry'), send).kind).toBe('sms_failed');
    expect(classifyPhoneError({ name: 'AuthRetryableFetchError', status: 500, code: 'hook_timeout_after_retry' }, send).kind).toBe('sms_failed');
  });
  it('verifyOtp 階段的 502 仍是 server（沒有完成，請再試一次。）', () => {
    expect(classifyPhoneError(retryable502, verify).kind).toBe('server');
    expect(classifyPhoneError(api(502, ''), verify).kind).toBe('unknown');
    expect(classifyPhoneError(api(422, 'hook_timeout'), verify).kind).toBe('unknown');
    expect(phoneErrorView('server').title).toBe('沒有完成，請再試一次。');
  });
  it('沒給 op 時不當簡訊失敗（保守，避免 verify 路徑漏帶 op）', () => {
    expect(classifyPhoneError(retryable502, { now: NOW }).kind).toBe('server');
  });
  it('其他 5xx 在送出階段不受影響：500 無 code（簽章不對）、503 仍是 server', () => {
    expect(classifyPhoneError({ name: 'AuthRetryableFetchError', status: 500 }, send).kind).toBe('server');
    expect(classifyPhoneError({ name: 'AuthRetryableFetchError', status: 503 }, send).kind).toBe('server');
    expect(classifyPhoneError({ name: 'AuthRetryableFetchError', status: 0 }, send).kind).toBe('network');
  });
});

describe('over_sms_send_rate_limit 有兩種意思（R-12）', () => {
  const limit = (message: string) => api(429, 'over_sms_send_rate_limit', message);
  it('這個門號 60 秒內傳送過 → 剛剛已經傳送過', () => {
    expect(classifyPhoneError(limit('SMS rate limit exceeded'), { now: NOW, lastSentAt: NOW - 30_000 }).kind).toBe('rate_limit_resend');
  });
  it('距上次傳送超過 60 秒 → 全站額度用完', () => {
    expect(classifyPhoneError(limit('SMS rate limit exceeded'), { now: NOW, lastSentAt: NOW - 61_000 }).kind).toBe('rate_limit_site');
  });
  it('前端沒有上次傳送時間（換分頁、換裝置）：伺服器訊息只當輔助判斷', () => {
    expect(classifyPhoneError(limit('For security purposes, you can only request this after 42 seconds.'), { now: NOW }).kind).toBe('rate_limit_resend');
    expect(classifyPhoneError(limit('SMS rate limit exceeded'), { now: NOW }).kind).toBe('rate_limit_site');
  });
  it('剛好 60 秒算已過（倒數結束就可以重傳）', () => {
    expect(classifyPhoneError(limit('SMS rate limit exceeded'), { now: NOW, lastSentAt: NOW - 60_000 }).kind).toBe('rate_limit_site');
  });
});

describe('畫面文字（design 第 6 節逐字）', () => {
  const view = (kind: PhoneErrorKind, inApp: Parameters<typeof phoneErrorView>[1] = {}) => phoneErrorView(kind, inApp);
  it('每一種都有中文，且沒有英文字母（絕不顯示英文原文）', () => {
    const kinds: PhoneErrorKind[] = ['invalid_phone', 'code_empty', 'otp_invalid', 'rate_limit_resend', 'rate_limit_site', 'rate_limit_ip', 'sms_failed',
      'phone_exists', 'provider_disabled', 'signup_disabled', 'captcha_failed', 'network', 'timeout', 'server', 'session_missing', 'unknown'];
    for (const k of kinds) {
      const v = view(k);
      expect(`${v.title}${v.body ?? ''}`.replace(/Apple|Google|Safari/g, ''), k).not.toMatch(/[A-Za-z]/);
      expect(v.title.length).toBeGreaterThan(0);
    }
  });
  it('逐字', () => {
    expect(view('rate_limit_resend')).toMatchObject({ kind: 'warning', title: '剛剛已經傳送過', body: '請稍等一下再重新傳送；收到的驗證碼仍然可以用。' });
    expect(view('rate_limit_site')).toMatchObject({ kind: 'warning', title: '目前簡訊傳送量太大', body: '請過一段時間再試，或改用 Apple／Google 登入。' });
    expect(view('sms_failed')).toMatchObject({ kind: 'error', title: '簡訊沒有送出', body: '請確認手機號碼，稍後再試，或改用 Apple／Google 登入。' });
    expect(view('rate_limit_ip').title).toBe('嘗試次數太多，請稍等一下再試。');
    expect(view('captcha_failed').title).toBe('安全驗證已失效，請再按一次傳送驗證碼。');
    expect(view('provider_disabled').title).toBe('目前暫停手機登入，請改用 Apple 或 Google。');
    expect(view('signup_disabled').title).toBe('目前暫停新帳號註冊，已經有帳號的人請改用原本的方式登入。');
    expect(view('network').title).toBe('連不上伺服器，請檢查網路後再試。');
    expect(view('timeout').title).toBe('伺服器回應太慢，請再試一次。');
    expect(view('unknown').title).toBe('沒有完成，請再試一次。');
    expect(view('server').title).toBe('沒有完成，請再試一次。');
    expect(view('otp_invalid').title).toBe('驗證碼不正確或已過期，請輸入最新一則簡訊的驗證碼，或重新傳送。');
    expect(view('phone_exists').title).toBe('這支手機已經用來登入另一個好物集帳號，不能綁到這裡。');
  });
  it('內建瀏覽器裡「改用 Apple／Google 登入」換成「用 Safari 開啟後…」', () => {
    expect(view('rate_limit_site', { inApp: 'line', ios: true }).body).toBe('請過一段時間再試，或用 Safari 開啟後改用 Apple／Google 登入。');
    expect(view('sms_failed', { inApp: 'line', ios: true }).body).toBe('請確認手機號碼，稍後再試，或用 Safari 開啟後改用 Apple／Google 登入。');
    expect(view('sms_failed', { inApp: 'facebook', ios: true }).body).toBe('請確認手機號碼，稍後再試，或用瀏覽器開啟後改用 Apple／Google 登入。');
    expect(view('sms_failed', { inApp: 'line', ios: false }).body).toBe('請確認手機號碼，稍後再試，或用瀏覽器開啟後改用 Apple／Google 登入。');
  });
});
