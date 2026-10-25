import { classifyAuthError, type AuthFailure } from '../auth/callback';
import { isSafeRoute } from '../auth/pending';

// App 內登入回跳網址的解析（純函式，不碰 Capacitor，才測得到）。
// 自訂 scheme 回跳：io.github.nightzhe.goodmarket://auth?code=…；供應商錯誤可能在 query 或 hash。

/** 自訂 URL scheme，與 bundle id／application id 相同；iOS Info.plist 與 AndroidManifest 都註冊了它 */
export const NATIVE_AUTH_SCHEME = 'io.github.nightzhe.goodmarket';
/** Supabase 的 redirectTo；要在 Supabase 後台 Redirect URLs 允許清單裡 */
export const NATIVE_AUTH_REDIRECT = `${NATIVE_AUTH_SCHEME}://auth`;

/** App 內登入的結果；由 auth.ts 用 window 事件（NATIVE_AUTH_EVENT）通知 AuthContext */
export type NativeAuthOutcome = 'signed_in' | 'cancelled' | 'failed';
export const NATIVE_AUTH_EVENT = 'goodmarket:native-auth';
/** Android 實體返回鍵：shell.ts 先發這個可取消的事件，AuthContext 有登入面板開著就關面板並 preventDefault，否則才回上一頁 */
export const NATIVE_BACK_EVENT = 'goodmarket:native-back';

// 結果信箱：冷啟動（App 被殺掉後由回跳網址叫醒）時，換 session 可能在 AuthContext 掛載前就結束，事件沒人聽；
// 所以先放進信箱再發事件，AuthContext 掛載時用 takeNativeAuthOutcome 補收。取走就清空，不會處理兩次。
let boxed: NativeAuthOutcome | null = null;

export function postNativeAuthOutcome(outcome: NativeAuthOutcome): void {
  boxed = outcome;
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent<NativeAuthOutcome>(NATIVE_AUTH_EVENT, { detail: outcome }));
}

export function takeNativeAuthOutcome(): NativeAuthOutcome | null {
  const o = boxed;
  boxed = null;
  return o;
}

/**
 * 一般深連結：io.github.nightzhe.goodmarket://review-login → 站內路由 '/review-login'（query 保留、hash 丟掉）。
 * 登入回跳（host＝auth）不在此列，由 parseNativeCallback 處理；不是本 App 的 scheme、或路由不安全，回 null。
 */
export function parseNativeRoute(url: string): string | null {
  let u: URL;
  try { u = new URL(url); } catch { return null; }
  if (u.protocol !== `${NATIVE_AUTH_SCHEME}:`) return null;
  const path = `/${u.host}${u.pathname}`.replace(/\/+$/, '') || '/';
  if (path === '/auth' || path.startsWith('/auth/')) return null;
  const route = `${path}${u.search}`;
  return isSafeRoute(route) ? route : null;
}

export interface NativeCallback {
  code: string | null;
  failure: AuthFailure | null;
}

/** 不是本 App 的登入回跳（別的 deep link）回 null */
export function parseNativeCallback(url: string): NativeCallback | null {
  let u: URL;
  try { u = new URL(url); } catch { return null; }
  if (u.protocol !== `${NATIVE_AUTH_SCHEME}:`) return null;
  if (u.host !== 'auth' && u.pathname.replace(/^\/+/, '') !== 'auth') return null;
  const query = u.searchParams;
  const hash = new URLSearchParams(u.hash.replace(/^#/, ''));
  const get = (k: string) => query.get(k) ?? hash.get(k);
  const error = get('error');
  const errorCode = get('error_code');
  const description = get('error_description');
  const failure = error || errorCode || description ? classifyAuthError({ error, errorCode, description }) : null;
  const code = get('code');
  return { code: code && !failure ? code : null, failure };
}
