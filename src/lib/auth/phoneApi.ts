import type { AuthError } from '@supabase/supabase-js';
import { supabase } from '../supabase';
import type { AuthErrorLike } from './phoneErrors';
import type { AuthMethod } from './identity';

// 手機登入／綁定的 Supabase 呼叫。每支都回傳 { error }，不丟例外：錯誤交給 phoneErrors.ts 用 code／name／status 分類。
// 重新傳送＝再呼叫一次（登入：signInWithOtp；綁定：updateUser），不用 resend：resend 對已確認的門號不寄、
// 對第一次綁定也不寄（t2-local-tests.md F-5）。

export type CallResult = { error: AuthErrorLike | null };

const failure = (e: unknown): AuthErrorLike => ({ name: 'UnexpectedError', message: e instanceof Error ? e.message : String(e) });

async function call(fn: () => Promise<{ error: AuthError | null }>): Promise<CallResult> {
  try {
    const { error } = await fn();
    return { error };
  } catch (e) {
    return { error: failure(e) };
  }
}

/** 傳送登入驗證碼；註冊與登入同一條路（shouldCreateUser）。captchaToken 只在 Turnstile 啟用時帶。不得讀回傳的 data（新舊門號會差一個 messageId） */
export const sendLoginCode = (phone: string, captchaToken?: string) =>
  call(() => supabase.auth.signInWithOtp({ phone, options: { shouldCreateUser: true, ...(captchaToken ? { captchaToken } : {}) } }));

/** 綁定手機：已登入的帳號加門號。/user 不檢查 Captcha */
export const sendBindCode = (phone: string) => call(() => supabase.auth.updateUser({ phone }));

export const verifyLoginCode = (phone: string, token: string) => call(() => supabase.auth.verifyOtp({ phone, token, type: 'sms' }));

export const verifyBindCode = (phone: string, token: string) => call(() => supabase.auth.verifyOtp({ phone, token, type: 'phone_change' }));

/** 這個 session 的登入方式（amr）。本地解 JWT，不打網路；讀不到回 null */
export async function currentLoginMethods(): Promise<AuthMethod[] | null> {
  try {
    const { data, error } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    if (error || !data) return null;
    return data.currentAuthenticationMethods.map(m => (typeof m === 'string' ? { method: m } : { method: String(m.method), timestamp: m.timestamp }));
  } catch {
    return null;
  }
}
