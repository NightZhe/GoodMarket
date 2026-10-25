import { describe, expect, it } from 'vitest';
import { CONTACT_EMAIL } from '../site';
import { classifyReviewLoginError, reviewLoginErrorText, type ReviewLoginErrorKind } from './errors';

const api = (status: number, code?: string) => ({ name: 'AuthApiError', status, code, message: 'raw english message' });

describe('classifyReviewLoginError：只看 code／name／status，不比對英文訊息', () => {
  const cases: [string, Parameters<typeof classifyReviewLoginError>[0], ReviewLoginErrorKind][] = [
    ['帳密錯', api(400, 'invalid_credentials'), 'invalid_credentials'],
    ['Email 登入關閉', api(422, 'email_provider_disabled'), 'provider_disabled'],
    ['安全驗證失敗', api(400, 'captcha_failed'), 'captcha_failed'],
    ['請求太頻繁 code', api(429, 'over_request_rate_limit'), 'rate_limit'],
    ['沒有 code 的 429', api(429), 'rate_limit'],
    ['離線', { name: 'AuthRetryableFetchError', status: 0 }, 'network'],
    ['15 秒逾時', { name: 'RequestTimeout', status: 408, code: 'request_timeout' }, 'network'],
    ['伺服器 5xx', { name: 'AuthRetryableFetchError', status: 500 }, 'other'],
    ['email 未確認', api(400, 'email_not_confirmed'), 'other'],
    ['沒有任何資訊', {}, 'other'],
    ['非預期例外', { name: 'UnexpectedError', message: 'boom' }, 'other'],
  ];
  it.each(cases)('%s', (_label, err, kind) => {
    expect(classifyReviewLoginError(err)).toBe(kind);
  });

  it('沒有 code 的 400 不當成帳密錯（不靠英文訊息猜）', () => {
    expect(classifyReviewLoginError({ name: 'AuthApiError', status: 400, message: 'Invalid login credentials' })).toBe('other');
  });
});

describe('reviewLoginErrorText：逐字對 spec §10.2，中英各自獨立', () => {
  it('六種文案', () => {
    expect(reviewLoginErrorText('invalid_credentials')).toEqual({ zh: '帳號或密碼不正確。', en: 'Incorrect email or password.' });
    expect(reviewLoginErrorText('provider_disabled')).toEqual({ zh: `這個登入方式目前已關閉，請來信 ${CONTACT_EMAIL}。`, en: 'Email sign-in is disabled.' });
    expect(reviewLoginErrorText('captcha_failed')).toEqual({ zh: '安全驗證沒有通過，請重新整理頁面後再試。', en: 'Security check failed, please reload.' });
    expect(reviewLoginErrorText('rate_limit')).toEqual({ zh: '嘗試太多次，請過幾分鐘再試。', en: 'Too many attempts, try again later.' });
    expect(reviewLoginErrorText('network')).toEqual({ zh: '連線失敗，請檢查網路後再試一次。', en: 'Network error.' });
    expect(reviewLoginErrorText('other')).toEqual({ zh: '登入失敗，請稍後再試。', en: 'Sign-in failed.' });
  });
  it('離線（沒送出）', () => {
    expect(reviewLoginErrorText('offline')).toEqual({ zh: '連上網路後才能登入', en: 'You are offline.' });
  });
});
