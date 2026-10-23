import { App } from '@capacitor/app';
import { nativePlatform } from './platform';
import { initNativeAuth } from './auth';

// 原生殼的啟動：只在 App 內由 main.tsx 動態載入（網頁 bundle 不含這些外掛）。
//   - <html> 加 class native／native-ios／native-android，殼專用樣式（native.css，由 main.tsx 靜態載入）靠它生效
//   - Android 實體返回鍵：hash 路由能回就回，回到底就離開 App
//   - 登入回跳與瀏覽器視圖的監聽

export async function initNativeShell(): Promise<void> {
  const platform = nativePlatform();
  if (!platform) return;
  document.documentElement.classList.add('native', `native-${platform}`);
  await initNativeAuth();
  await App.addListener('backButton', ({ canGoBack }) => {
    if (canGoBack) window.history.back();
    else void App.exitApp();
  });
}
