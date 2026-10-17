import { pendingToParams, type PendingAction } from './pending';

// LINE、Facebook、Instagram 的內建瀏覽器：Google 從 2021 年起擋掉嵌入式 WebView 的登入（disallowed_useragent）。
// 偵測靠 User-Agent，字串各版本是否一致未實機查證（K-7），所以偵測只決定「顯示什麼」，不擋任何其他功能。

export type InAppKind = 'line' | 'facebook' | 'instagram';

export function detectInApp(ua: string): InAppKind | null {
  if (/Instagram/i.test(ua)) return 'instagram';
  if (/FBAN|FBAV|FB_IAB|FBIOS|FB4A/.test(ua)) return 'facebook';
  if (/\bLine\/\d/.test(ua)) return 'line';
  return null;
}

export const isIOS = (ua: string) => /iPhone|iPad|iPod/.test(ua);

/**
 * 內建瀏覽器裡 Apple 登入能不能用，要 qa 實機測了才知道（AC-37、K-6）。
 * 測過可用的 App 改成 true，說明畫面就會多出 Apple 按鈕（S-3c）；預設全部不顯示，寧可請使用者換瀏覽器也不要讓人撞牆。
 */
export const APPLE_USABLE_IN_APP: Record<InAppKind, boolean> = { line: false, facebook: false, instagram: false };

export const inAppName = (k: InAppKind) => (k === 'line' ? 'LINE' : k === 'facebook' ? 'Facebook' : 'Instagram');

/**
 * 外開或複製用的網址：目前這一頁（含 # 路由），加上待辦動作。
 * LINE 的 ?openExternalBrowser=1 必須在 # 之前（query 放 hash 後面不會生效）；FB／IG 沒有這個機制，不帶。
 */
export function buildExternalUrl(
  loc: { origin: string; pathname: string; hash: string },
  pending: PendingAction | null,
  openExternal: boolean,
): string {
  const params = new URLSearchParams();
  if (openExternal) params.set('openExternalBrowser', '1');
  const p = pending ? pendingToParams(pending) : null;
  p?.forEach((v, k) => params.set(k, v));
  const q = params.toString();
  return `${loc.origin}${loc.pathname}${q ? `?${q}` : ''}${loc.hash}`;
}
