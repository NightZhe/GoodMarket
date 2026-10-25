import { App } from '@capacitor/app';
import { nativePlatform } from './platform';
import { initNativeAuth } from './auth';
import { initNativeDeepLinks } from './deeplink';
import { NATIVE_BACK_EVENT } from './callback';

// 原生殼的啟動：只在 App 內由 main.tsx 動態載入（網頁 bundle 不含這些外掛）。
//   - <html> 加 class native／native-ios／native-android，殼專用樣式（native.css，由 main.tsx 靜態載入）靠它生效
//   - 狀態列文字深色（白底 App）
//   - Android 實體返回鍵：先問畫面（登入面板開著就只關面板），再來 hash 路由能回就回，回到底就離開 App
//   - 登入回跳與瀏覽器視圖的監聽；一般深連結（審查員登入頁 ://review-login）

export async function initNativeShell(): Promise<void> {
  const platform = nativePlatform();
  if (!platform) return;
  document.documentElement.classList.add('native', `native-${platform}`);
  // 狀態列文字顏色（D-7d）：App 只有白底，時間／電量要深色。capacitor.config.ts 的 plugins.StatusBar.style 讓第一幀就對，
  // 這裡再設一次是保險。Capacitor 的命名：Style.Light＝淺色背景配深色文字（不是淺色文字）。
  void import('@capacitor/status-bar').then(({ StatusBar, Style }) => StatusBar.setStyle({ style: Style.Light })).catch(() => { /* 外掛不在就算了 */ });
  await initNativeAuth();
  await initNativeDeepLinks();
  // 狀態列安全區：買家前台（App Store 風改版後）自己處理（安全區色帶＋sticky top-[env(...)] 頂欄），殼不插手；
  // 只有還沒改版的賣家側要補：賣家中心的 header.sticky top-0 由 native.css 讓它長高，賣家登入頁（沒有黏頂頂欄）把 body 往下推。
  // 用 MutationObserver 看 DOM（路由切換是 pushState，不會發 hashchange）；不用 CSS :has()（WKWebView 上實測沒有命中，原因未查明）。
  const sellerRoute = () => /^#\/seller(\/|$)/.test(window.location.hash);
  const syncStickyClass = () => {
    const noSticky = sellerRoute() && !document.querySelector('header.sticky');
    document.documentElement.classList.toggle('native-no-sticky', noSticky);
  };
  new MutationObserver(syncStickyClass).observe(document.body, { childList: true, subtree: true });
  syncStickyClass();
  await App.addListener('backButton', ({ canGoBack }) => {
    const consumed = !window.dispatchEvent(new CustomEvent(NATIVE_BACK_EVENT, { cancelable: true }));
    if (consumed) return;
    if (canGoBack) window.history.back();
    else void App.exitApp();
  });
}
