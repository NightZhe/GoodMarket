import { App } from '@capacitor/app';
import { parseNativeRoute } from './callback';

// 一般深連結（decisions D-10／N12）：io.github.nightzhe.goodmarket://review-login 等 → 直接切 hash 路由。
// 審查員只能從 App 外（Safari 網址列、備忘錄）打開這個網址進到隱藏的審查登入頁；畫面上沒有任何連結。
// 登入回跳（://auth）由 auth.ts 處理，這裡會略過。冷啟動時 appUrlOpen 與 getLaunchUrl 可能給同一個網址，只處理一次。

let lastUrl: string | null = null;
let listening = false;

function openRoute(url: string) {
  const route = parseNativeRoute(url);
  if (!route || url === lastUrl) return;
  lastUrl = url;
  // hash 路由器建立前就設好 hash 也沒關係：它建立時會讀目前的 hash；建立後則是 hashchange 導頁
  window.location.hash = `#${route}`;
}

export async function initNativeDeepLinks(): Promise<void> {
  if (listening) return;
  listening = true;
  await App.addListener('appUrlOpen', e => openRoute(e.url));
  const launch = await App.getLaunchUrl().catch(() => null);
  if (launch?.url) openRoute(launch.url);
}
