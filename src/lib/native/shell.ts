import { App } from '@capacitor/app';
import { nativePlatform } from './platform';
import { initNativeAuth } from './auth';
import { NATIVE_BACK_EVENT } from './callback';

// 原生殼的啟動：只在 App 內由 main.tsx 動態載入（網頁 bundle 不含這些外掛）。
//   - <html> 加 class native／native-ios／native-android，殼專用樣式（native.css，由 main.tsx 靜態載入）靠它生效
//   - Android 實體返回鍵：先問畫面（登入面板開著就只關面板），再來 hash 路由能回就回，回到底就離開 App
//   - 登入回跳與瀏覽器視圖的監聽

export async function initNativeShell(): Promise<void> {
  const platform = nativePlatform();
  if (!platform) return;
  document.documentElement.classList.add('native', `native-${platform}`);
  await initNativeAuth();
  // 狀態列安全區：有黏頂頂欄（header.sticky）的頁面由頂欄自己長高；沒有的頁面（賣家登入頁等）把 body 往下推。
  // 用 MutationObserver 看 DOM，不用 CSS :has()（WKWebView 上實測沒有命中，原因未查明）。
  // 路由切換是 pushState，不會發 hashchange，所以只能看 DOM 變化。
  const syncStickyClass = () => {
    const noSticky = !document.querySelector('header.sticky');
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
