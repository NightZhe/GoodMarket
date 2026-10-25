import { describe, expect, it } from 'vitest';
import { DEFAULT_CAPTCHA_PAGE, NATIVE_CAPTCHA_REDIRECT, captchaPageUrl, parseNativeCaptchaCallback } from './captchaUrl';

describe('captchaPageUrl', () => {
  it('正式站 captcha.html 帶 sitekey 與回跳 scheme', () => {
    expect(captchaPageUrl(DEFAULT_CAPTCHA_PAGE, '0x4AAAAAAFh8HZ6cfA1LLg9i'))
      .toBe('https://nightzhe.github.io/GoodMarket/captcha.html?sitekey=0x4AAAAAAFh8HZ6cfA1LLg9i&return=io.github.nightzhe.goodmarket%3A%2F%2Fcaptcha');
  });
});

describe('parseNativeCaptchaCallback', () => {
  it('讀出 token', () => {
    expect(parseNativeCaptchaCallback(`${NATIVE_CAPTCHA_REDIRECT}?token=0.abc-DEF_ghi`)).toEqual({ token: '0.abc-DEF_ghi' });
  });
  it('取消：沒有 token', () => {
    expect(parseNativeCaptchaCallback(`${NATIVE_CAPTCHA_REDIRECT}?cancelled=1`)).toEqual({ token: null });
    expect(parseNativeCaptchaCallback(NATIVE_CAPTCHA_REDIRECT)).toEqual({ token: null });
    expect(parseNativeCaptchaCallback(`${NATIVE_CAPTCHA_REDIRECT}?token=`)).toEqual({ token: null });
  });
  it('不是安全驗證回跳的網址回 null', () => {
    expect(parseNativeCaptchaCallback('io.github.nightzhe.goodmarket://auth?code=x')).toBeNull();
    expect(parseNativeCaptchaCallback('io.github.nightzhe.goodmarket://review-login')).toBeNull();
    expect(parseNativeCaptchaCallback('https://nightzhe.github.io/GoodMarket/captcha.html?token=x')).toBeNull();
    expect(parseNativeCaptchaCallback('not a url')).toBeNull();
  });
});
