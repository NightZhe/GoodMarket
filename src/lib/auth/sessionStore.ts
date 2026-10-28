import type { StorageLike } from './pending';

// session 儲存轉接器（keep-signed-in T1，spec §4.1）：給 supabase-js 的 auth.storage 用。
// App 內把登入狀態放進手機的安全儲存（iOS Keychain、Android KeyStore 加密），系統清 WebView 資料後還在。
//   - 兩個後端：安全儲存（Capacitor 外掛，動態載入、全 async）與備援儲存（WebView localStorage，今天的位置）。
//   - 讀：安全儲存有就回；只有備援有 → 搬進安全儲存、刪備援、回值（舊版 App 升級不重登）；都沒有 → null。
//   - 寫：只寫安全儲存，備援的舊份順手清掉（token 不留兩份）。刪：兩邊都刪（登出不留任何一份）。
//   - 安全儲存任何一步丟例外（含外掛載入失敗）→ 這次改走備援，並記住「安全儲存不可用」，之後讀寫都走備援；
//     不往上丟給 supabase-js。最壞情況＝回到今天的行為（localStorage）。降級後的寫與刪仍會盡力刪掉安全儲存裡的同 key，
//     免得外掛恢復後舊 session 復活（D4：登出＝撤銷）。
//   - 任何 log 只記事件類別與錯誤代碼，不含 key 的值（值是 token），也不轉傳例外訊息。
// 網頁版不建這個轉接器，supabase-js 維持預設。

export interface AsyncStorageLike {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

export interface SessionStoreOptions {
  /** 安全儲存的載入函式（外掛是動態 import，第一次用到才載）；載入失敗視同不可用 */
  secure: () => Promise<AsyncStorageLike>;
  /** 備援儲存（同步，localStorage 介面） */
  fallback: StorageLike;
  /** 只在出事時被叫；訊息不含值 */
  log?: (message: string) => void;
}

/** 只取錯誤代碼或類別名，不取 message（外掛的 message 可能帶 key，而且沒必要） */
function errorCode(e: unknown): string {
  if (typeof e === 'object' && e !== null) {
    const code = (e as { code?: unknown }).code;
    if (typeof code === 'string') return code;
    const name = (e as { name?: unknown }).name;
    if (typeof name === 'string') return name;
  }
  return 'unknown';
}

/** 安全儲存出事時是在哪一步（進 log 用） */
type SecureOp = 'load' | 'getItem' | 'setItem' | 'removeItem' | 'migrate';

export function createSessionStore(opts: SessionStoreOptions): AsyncStorageLike {
  const log = opts.log ?? (() => {});
  let degraded = false;
  let loading: Promise<AsyncStorageLike | null> | null = null;
  /** 外掛載入成功後留一份引用：降級後仍拿它「盡力」清掉安全儲存裡的同 key */
  let loaded: AsyncStorageLike | null = null;

  const giveUp = (op: SecureOp, e: unknown) => {
    degraded = true;
    log(`session-store: secure storage unavailable at ${op} (${errorCode(e)}); using fallback storage from now on`);
  };

  /** 安全儲存；null＝不可用（這個 App 生命週期內讀寫都走備援） */
  const secureStore = (): Promise<AsyncStorageLike | null> => {
    if (degraded) return Promise.resolve(null);
    loading ??= opts.secure()
      .then(s => { loaded = s; return s; })
      .catch((e: unknown) => { giveUp('load', e); return null; });
    return loading;
  };

  /**
   * 降級後的寫與刪：備援是正本，但安全儲存裡可能還留著舊 session。外掛若只是暫時失效，重啟後 getItem 會優先讀到那份舊的，
   * 登出的人會「復活」（違反 D4 登出＝撤銷）、換過 token 的人會拿到舊 token。所以盡力把安全儲存的同 key 刪掉；刪不掉就算了。
   */
  const bestEffortSecureRemove = async (key: string): Promise<void> => {
    if (!loaded) return;
    try { await loaded.removeItem(key); } catch { /* 已經降級，沒有更多能做的 */ }
  };

  // 備援（localStorage）本身也可能丟例外（隱私設定、空間滿）；一樣不往上丟
  const fallbackSafe = {
    get: (key: string): string | null => {
      try { return opts.fallback.getItem(key); } catch (e) { log(`session-store: fallback getItem failed (${errorCode(e)})`); return null; }
    },
    set: (key: string, value: string): void => {
      try { opts.fallback.setItem(key, value); } catch (e) { log(`session-store: fallback setItem failed (${errorCode(e)})`); }
    },
    remove: (key: string): void => {
      try { opts.fallback.removeItem(key); } catch (e) { log(`session-store: fallback removeItem failed (${errorCode(e)})`); }
    },
  };

  return {
    async getItem(key) {
      const s = await secureStore();
      if (s) {
        let inSecure: string | null;
        try { inSecure = await s.getItem(key); } catch (e) { giveUp('getItem', e); return fallbackSafe.get(key); }
        if (inSecure !== null) return inSecure;
        // 搬移：安全儲存沒有、備援有 → 複製過去、刪掉備援那份。備援刪掉後第二次讀自然不會再碰它
        const inFallback = fallbackSafe.get(key);
        if (inFallback === null) return null;
        try {
          await s.setItem(key, inFallback);
          fallbackSafe.remove(key);
        } catch (e) {
          giveUp('migrate', e); // 搬不過去就留在備援，值照回
        }
        return inFallback;
      }
      return fallbackSafe.get(key);
    },
    async setItem(key, value) {
      const s = await secureStore();
      if (s) {
        try {
          await s.setItem(key, value);
          fallbackSafe.remove(key);
          return;
        } catch (e) { giveUp('setItem', e); }
      }
      fallbackSafe.set(key, value);
      await bestEffortSecureRemove(key);
    },
    async removeItem(key) {
      const s = await secureStore();
      if (s) {
        try { await s.removeItem(key); } catch (e) { giveUp('removeItem', e); }
      } else {
        await bestEffortSecureRemove(key);
      }
      fallbackSafe.remove(key);
    },
  };
}
