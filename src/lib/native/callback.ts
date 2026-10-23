import { classifyAuthError, type AuthFailure } from '../auth/callback';

// App 內登入回跳網址的解析（純函式，不碰 Capacitor，才測得到）。
// 自訂 scheme 回跳：io.github.nightzhe.goodmarket://auth?code=…；供應商錯誤可能在 query 或 hash。

/** 自訂 URL scheme，與 bundle id／application id 相同；iOS Info.plist 與 AndroidManifest 都註冊了它 */
export const NATIVE_AUTH_SCHEME = 'io.github.nightzhe.goodmarket';
/** Supabase 的 redirectTo；要在 Supabase 後台 Redirect URLs 允許清單裡 */
export const NATIVE_AUTH_REDIRECT = `${NATIVE_AUTH_SCHEME}://auth`;

/** App 內登入的結果；由 auth.ts 用 window 事件（NATIVE_AUTH_EVENT）通知 AuthContext */
export type NativeAuthOutcome = 'signed_in' | 'cancelled' | 'failed';
export const NATIVE_AUTH_EVENT = 'goodmarket:native-auth';

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
