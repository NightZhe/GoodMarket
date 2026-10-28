import { createSessionStore, type AsyncStorageLike } from '../auth/sessionStore';
import type { StorageLike } from '../auth/pending';

// App 內的 session 儲存：安全儲存＝@aparajita/capacitor-secure-storage（iOS Keychain、Android KeyStore 加密），
// 備援＝WebView 的 localStorage（今天 supabase-js 的預設位置，舊版 App 的 session 在這裡，第一次讀會被搬走）。
// 外掛用動態 import：這支模組本身由 supabase.ts 靜態載入（client 建立時就要有 storage 物件），
// 但外掛的程式碼切成另一個 chunk，只有 App 內第一次存取 session 才會抓；網頁版的進入 bundle 不含外掛（AC-6）。
// 任何 log 只記類別，不含值（見 createSessionStore）。

/** localStorage 被擋或不存在時給一個什麼都沒有的備援，轉接器照樣不會丟例外 */
function webViewLocalStorage(): StorageLike {
  try {
    if (typeof localStorage !== 'undefined') return localStorage;
  } catch { /* 被擋 */ }
  return { getItem: () => null, setItem: () => {}, removeItem: () => {} };
}

export function nativeSessionStore(): AsyncStorageLike {
  return createSessionStore({
    secure: async () => {
      const { SecureStorage } = await import('@aparajita/capacitor-secure-storage');
      return SecureStorage;
    },
    fallback: webViewLocalStorage(),
    log: message => { console.warn(message); },
  });
}
