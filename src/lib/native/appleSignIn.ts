import type { AuthFailure } from '../auth/callback';

// 原生 Sign in with Apple 的純函式（不碰 Capacitor，才測得到）。流程在 auth.ts 的 startNativeAppleSignIn。
//
// nonce 的規則（Supabase 與 Apple 文件）：給 Apple 的是 SHA-256 過的值（會原樣進 identity token 的 nonce claim），
// 給 Supabase signInWithIdToken 的是沒 hash 的原值，Supabase 自己 hash 後比對 token 裡的 claim。

/** 32 bytes 隨機值的 hex 字串；bytes 由呼叫端用 crypto.getRandomValues 產生 */
export function nonceFromBytes(bytes: Uint8Array): string {
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return nonceFromBytes(new Uint8Array(digest));
}

/**
 * 外掛 reject 時只給 error.localizedDescription（例如「無法完成操作。(com.apple.AuthenticationServices.AuthorizationError錯誤1001。)」），
 * ASAuthorizationError.canceled 的代碼是 1001：使用者關掉系統表單＝取消，其他（1000 unknown、1004 failed…）都是失敗。
 */
export function classifyAppleSignInError(error: unknown): AuthFailure {
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : String((error as { message?: unknown } | null)?.message ?? '');
  return /(^|\D)1001(\D|$)|cancel/i.test(message) ? 'cancelled' : 'failed';
}

/** 外掛回傳的 identityToken 要是非空字串才拿去換 session */
export function identityTokenOf(response: { identityToken?: string | null } | null | undefined): string | null {
  const t = response?.identityToken;
  return typeof t === 'string' && t.length > 0 ? t : null;
}
