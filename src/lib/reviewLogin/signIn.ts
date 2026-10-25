import { supabase } from '../supabase';
import { REQUEST_TIMEOUT_MS } from '../auth/phoneApi';
import { raceTimeout } from '../auth/raceTimeout';
import type { ReviewLoginErrorLike } from './errors';

// 唯一的呼叫點。每次都回 { error }，不丟例外；伺服器 15 秒沒回應就放棄等待（auth-js 的呼叫不收 signal）。
// 登入成功後的全站狀態由既有的 onAuthStateChange 接手，這裡不用處理 session。

export type SignInResult = { error: ReviewLoginErrorLike | null };

const TIMED_OUT: SignInResult = { error: { name: 'RequestTimeout', code: 'request_timeout', status: 408 } };

/** captchaToken 只在 Turnstile 啟用時帶；沒有 sitekey 的本機不帶 */
export async function signInWithEmail(email: string, password: string, captchaToken?: string): Promise<SignInResult> {
  try {
    return await raceTimeout(
      supabase.auth
        .signInWithPassword({ email, password, ...(captchaToken ? { options: { captchaToken } } : {}) })
        .then(({ error }): SignInResult => ({ error })),
      REQUEST_TIMEOUT_MS,
      () => TIMED_OUT,
    );
  } catch (e) {
    return { error: { name: 'UnexpectedError', message: e instanceof Error ? e.message : String(e) } };
  }
}
