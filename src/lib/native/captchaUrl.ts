import { NATIVE_AUTH_SCHEME } from './callback';

// 方案 B（系統瀏覽器視圖做 Turnstile）的純函式：組正式站 captcha.html 的網址、解析回跳。不碰 Capacitor，才測得到。
// 回跳：io.github.nightzhe.goodmarket://captcha?token=…（通過）或 ?cancelled=1（使用者按「先回到好物集」）。

export const NATIVE_CAPTCHA_REDIRECT = `${NATIVE_AUTH_SCHEME}://captcha`;
export const DEFAULT_CAPTCHA_PAGE = 'https://nightzhe.github.io/GoodMarket/captcha.html';
/** 可用 VITE_TURNSTILE_PAGE_URL 指到本機 dev server；預設正式站 */
export const CAPTCHA_PAGE_URL = ((import.meta.env.VITE_TURNSTILE_PAGE_URL as string | undefined) ?? '').trim() || DEFAULT_CAPTCHA_PAGE;

export function captchaPageUrl(base: string, sitekey: string): string {
  const u = new URL(base);
  u.searchParams.set('sitekey', sitekey);
  u.searchParams.set('return', NATIVE_CAPTCHA_REDIRECT);
  return u.toString();
}

/** 不是安全驗證的回跳回 null；是回跳但沒有 token（取消）回 { token: null } */
export function parseNativeCaptchaCallback(url: string): { token: string | null } | null {
  let u: URL;
  try { u = new URL(url); } catch { return null; }
  if (u.protocol !== `${NATIVE_AUTH_SCHEME}:`) return null;
  if (u.host !== 'captcha' && u.pathname.replace(/^\/+/, '') !== 'captcha') return null;
  const token = u.searchParams.get('token');
  return { token: token ? token : null };
}
