import { parseNativeRoute } from './callback';

// 一般深連結（decisions D-10／N12）：io.github.nightzhe.goodmarket://review-login 等 → 直接切 hash 路由。
// 審查員只能從 App 外打開這個網址進到隱藏的審查登入頁；畫面上沒有任何連結。
//   iOS：Safari 網址列或備忘錄貼上網址；Android：Chrome 不會把手打的自訂 scheme 交給 App，要點正式站 public/review-login.html 上的 intent:// 連結，
//   或 adb shell am start -a android.intent.action.VIEW -d io.github.nightzhe.goodmarket://review-login
// 登入回跳（://auth）由 auth.ts 處理，parseNativeRoute 會回 null 略過。
// appUrlOpen 的監聽與 getLaunchUrl 在 shell.ts 只做一次、同一個網址同時交給 auth.ts 與這裡（Android 把監聽登記前暫存的事件只給第一個監聽者）。

/** 深連結進站：已經在那一頁就不動（冷啟動時 appUrlOpen 與 getLaunchUrl 會給同一個網址）；離開後再點同一個連結要能再進來，所以不以「網址看過」去重 */
export function openNativeRoute(url: string): void {
  const route = parseNativeRoute(url);
  if (!route) return;
  const target = `#${route}`;
  if (window.location.hash === target) return;
  // hash 路由器建立前就設好 hash 也沒關係：它建立時會讀目前的 hash；建立後則是 hashchange 導頁
  window.location.hash = target;
}
