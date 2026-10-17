import { HANDOFF_PARAMS, isSafeRoute, paramsToPending, type PendingAction } from './pending';

// 登入回跳網址的處理。本站是 hash 路由（/GoodMarket/#/product/x），Supabase 預設的 implicit 流程
// 會把 token 接在 # 後面跟路由打架，所以改用 PKCE：回跳網址是 https://…/GoodMarket/?code=…（不帶 #）。
// 這支檔案只做「讀網址、算出乾淨的網址」，不碰 window，才測得到。

const AUTH_QUERY = ['code', 'error', 'error_code', 'error_description', 'sb_flow_id'] as const;
/** 舊的 implicit 流程（例如舊的確認信連結）會帶這些：不拿來登入，但不能留在網址上 */
const IMPLICIT_TOKENS = ['access_token', 'refresh_token', 'expires_in', 'expires_at', 'token_type', 'provider_token', 'provider_refresh_token', 'type'] as const;
const EXTERNAL_PARAM = 'openExternalBrowser';

export type AuthFailure = 'cancelled' | 'failed';

export interface AuthCallback {
  code: string | null;
  /** 供應商回報的錯誤（query 或 hash 都讀）；null＝沒有錯誤參數 */
  failure: AuthFailure | null;
}

export interface ParsedLocation {
  callback: AuthCallback;
  /** LINE 外開帶過來的待辦動作 */
  handoff: PendingAction | null;
  /** 網址上有任何需要清掉的參數 */
  dirty: boolean;
  /** 清乾淨之後的網址（pathname + search + hash），給 history.replaceState */
  cleanedHref: string;
  /** hash 路由目前指的站內路徑（沒有就是 '/'） */
  route: string;
}

const CANCEL_PATTERN = /access[_ ]?denied|user[_ ]?(cancel|denied)|cancel/i;

/**
 * 使用者在 Google／Apple 頁面按取消或拒絕授權，跟「登入真的壞了」要分開處理：
 * 前者只要輕輕說一聲，後者要讓人重試。供應商與 Supabase 怎麼命名取消不完全確定（未查證），
 * 所以 error、error_code、error_description 三個欄位都看。
 */
export function classifyAuthError(e: { error?: string | null; errorCode?: string | null; description?: string | null }): AuthFailure {
  return [e.error, e.errorCode, e.description].some(v => v && CANCEL_PATTERN.test(v)) ? 'cancelled' : 'failed';
}

/** hash 路由目前指的站內路徑；不是路由（空的、供應商參數）或不安全就是首頁 */
export const routeOfHash = (hash: string) => {
  if (!hash.startsWith('#/')) return '/';
  const r = hash.slice(1);
  return isSafeRoute(r) ? r : '/';
};

export function parseLocation(pathname: string, search: string, hash: string, now: number): ParsedLocation {
  const query = new URLSearchParams(search);
  // 以 #/ 開頭的 hash 是路由；其餘（#error=…、#access_token=…）才是供應商塞進來的參數
  const hashIsRoute = hash === '' || hash.startsWith('#/');
  const hashParams = hashIsRoute ? new URLSearchParams() : new URLSearchParams(hash.slice(1));

  const get = (k: string) => query.get(k) ?? hashParams.get(k);
  const code = get('code');
  const error = get('error');
  const errorCode = get('error_code');
  const description = get('error_description');
  const hasError = Boolean(error || errorCode || description);
  const failure = hasError ? classifyAuthError({ error, errorCode, description }) : null;

  const route = routeOfHash(hash);
  const handoff = paramsToPending(query, route, now);

  let dirty = false;
  for (const k of [...AUTH_QUERY, ...IMPLICIT_TOKENS, EXTERNAL_PARAM, ...HANDOFF_PARAMS]) {
    if (query.has(k)) { query.delete(k); dirty = true; }
  }
  let nextHash = hash;
  if (!hashIsRoute) {
    // 整段 hash 都是供應商參數：全部丟掉（保留路由是不可能的，它們根本不在同一個 hash 裡）
    nextHash = '';
    dirty = true;
  }
  const q = query.toString();
  return {
    callback: { code: code && !failure ? code : null, failure },
    handoff,
    dirty,
    cleanedHref: `${pathname}${q ? `?${q}` : ''}${nextHash}`,
    route,
  };
}

/** 登入完要回的網址：目前的站台根（含 GitHub Pages 子路徑），不帶 query 與 hash（R-4） */
export const redirectUrl = (loc: { origin: string; pathname: string }) => `${loc.origin}${loc.pathname}`;

/** 隱私政策頁的完整網址（另開分頁用：原頁的規格與待辦動作完全不動） */
export const privacyUrl = (loc: { origin: string; pathname: string }) => `${redirectUrl(loc)}#/privacy`;

/** 把 hash 路由換成指定的站內路徑，其餘照舊 */
export const withRoute = (cleanedHref: string, route: string) => {
  const i = cleanedHref.indexOf('#');
  return `${i === -1 ? cleanedHref : cleanedHref.slice(0, i)}#${route}`;
};
