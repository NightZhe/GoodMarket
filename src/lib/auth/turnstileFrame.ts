// App（iOS Capacitor）內的 Turnstile：WebView 來源是 capacitor://nightzhe.github.io，Cloudflare 只接受 http／https 來源
// （社群 811273 由 Cloudflare 員工確認 scheme 是元兇），所以 widget 改畫在正式站的 public/captcha-frame.html（https 來源），
// 登入面板放一個 iframe 載它，事件用 postMessage 往上送。這裡是純函式：組 iframe 網址、驗 postMessage。不碰 window。
import type { TsEvent } from './turnstileState';

export const DEFAULT_FRAME_URL = 'https://nightzhe.github.io/GoodMarket/captcha-frame.html';
/** 可用 VITE_TURNSTILE_FRAME_URL 指到本機 dev server（模擬器可連 Mac 的 localhost）；預設正式站 */
export const FRAME_URL = ((import.meta.env.VITE_TURNSTILE_FRAME_URL as string | undefined) ?? '').trim() || DEFAULT_FRAME_URL;
/** postMessage 的 type，雙向都用這個值（captcha.js 同一個字串） */
export const FRAME_MSG = 'gm-turnstile';

export function frameSrc(base: string, sitekey: string): string {
  const u = new URL(base);
  u.searchParams.set('sitekey', sitekey);
  return u.toString();
}

/** 只收這個來源送來的訊息（正式站是 https://nightzhe.github.io） */
export const frameOrigin = (base: string): string => new URL(base).origin;

export type FrameMessage =
  | { event: 'loaded' }
  | { event: 'token'; token: string }
  | { event: 'height'; height: number }
  | { event: 'error'; code: string }
  | { event: 'interactive' | 'after-interactive' | 'expired' | 'timeout' | 'script-failed' };

const SIMPLE = new Set(['interactive', 'after-interactive', 'expired', 'timeout', 'script-failed']);

/** 來源不對、格式不對都回 null，一律不處理 */
export function parseFrameMessage(data: unknown, origin: string, expectedOrigin: string): FrameMessage | null {
  if (origin !== expectedOrigin) return null;
  if (typeof data !== 'object' || data === null) return null;
  const d = data as Record<string, unknown>;
  if (d.type !== FRAME_MSG || typeof d.event !== 'string') return null;
  switch (d.event) {
    case 'loaded': return { event: 'loaded' };
    case 'token': return typeof d.token === 'string' && d.token !== '' ? { event: 'token', token: d.token } : null;
    case 'height': return typeof d.height === 'number' && Number.isFinite(d.height) && d.height >= 0 ? { event: 'height', height: d.height } : null;
    case 'error': return { event: 'error', code: typeof d.code === 'string' ? d.code : '' };
    default: return SIMPLE.has(d.event) ? { event: d.event as 'interactive' } : null;
  }
}

/** 對到既有六種狀態的狀態機；loaded／height／after-interactive 不是狀態事件 */
export function frameEventToTs(m: FrameMessage): TsEvent | null {
  switch (m.event) {
    case 'token': return { type: 'token' };
    case 'interactive': return { type: 'interactive' };
    case 'error': return { type: 'error' };
    case 'expired': return { type: 'expired' };
    case 'timeout': return { type: 'timeout' };
    case 'script-failed': return { type: 'script-failed' };
    default: return null;
  }
}
