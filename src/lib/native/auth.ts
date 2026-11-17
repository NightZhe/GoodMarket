import { Browser } from '@capacitor/browser';
import { supabase } from '../supabase';
import type { OAuthProvider, OAuthStart } from '../auth/oauth';
import { NATIVE_AUTH_REDIRECT, NATIVE_AUTH_SCHEME, parseNativeCallback, postNativeAuthOutcome, type NativeAuthOutcome } from './callback';
import { nativePlatform } from './platform';
import { classifyAppleSignInError, identityTokenOf, nonceFromBytes, sha256Hex } from './appleSignIn';

// App 內的 Google／Apple 登入（decisions.md D-4）。
// Google 擋嵌入式 WebView，所以不能在 App 的 WebView 裡整頁跳轉；改成：
//   1. signInWithOAuth 只拿網址（skipBrowserRedirect），redirectTo 是自訂 scheme
//   2. 用系統瀏覽器視圖開它（iOS SFSafariViewController、Android Custom Tabs）
//   3. Supabase 302 回自訂 scheme → appUrlOpen 收到 ?code= → 用 PKCE 換 session（verifier 在 WebView 的儲存，與發動端同一個）
//   4. 關掉瀏覽器視圖；結果用 window 事件通知 AuthContext（同一頁完成，像手機簡訊登入那樣不會重新載入）
// 例外：iOS 的 Apple 登入走原生 Sign in with Apple（D-5／D-7a，見 startNativeAppleSignIn），不開瀏覽器視圖。

let inFlight = false;
let handled = false;
let listening = false;
/** 冷啟動時 appUrlOpen 與 getLaunchUrl 會給同一個網址：同一個回跳只處理一次（一個 code 換兩次第二次必失敗） */
let lastUrl: string | null = null;
/**
 * 已經換過 session 的 code 另外記在 localStorage：WebView 重新載入（iOS 內容程序掛掉後 Capacitor reload、Android Activity 重建或程序被殺後還原）
 * 時 getLaunchUrl 會再給同一個回跳網址，而模組變數 lastUrl 已經跟著 JS 一起消失；再換一次 PKCE verifier 已被刪，
 * 會在已登入的畫面上蓋一個「登入沒有完成」。只記 code（一次性），同一個錯誤回跳還是每次都回報。
 */
const CONSUMED_CODE_KEY = 'goodmarket_native_auth_consumed_code';
function consumedCode(): string | null {
  try { return localStorage.getItem(CONSUMED_CODE_KEY); } catch { return null; }
}
function rememberConsumedCode(code: string): void {
  try { localStorage.setItem(CONSUMED_CODE_KEY, code); } catch { /* localStorage 被擋就只靠 lastUrl */ }
}
/** 瀏覽器視圖關掉後等多久沒有回跳才算取消：Android 的回跳 intent 以 singleTask 重新帶起 Activity，browserFinished 一定比 appUrlOpen 早到且間隔不定，放寬 */
const cancelGraceMs = () => (nativePlatform() === 'android' ? 1500 : 600);

/** 結果先進 callback.ts 的信箱再發事件：冷啟動時 AuthContext 可能還沒掛載，掛載後會到信箱補收 */
function emit(outcome: NativeAuthOutcome) {
  inFlight = false;
  postNativeAuthOutcome(outcome);
}

/** 登入回跳網址進來（appUrlOpen 或 getLaunchUrl，由 shell.ts 統一餵）；不是 ://auth 的深連結直接略過 */
export async function handleNativeAuthUrl(url: string): Promise<void> {
  const cb = parseNativeCallback(url);
  if (!cb) return;
  if (url === lastUrl) return;
  lastUrl = url;
  handled = true;
  // 關瀏覽器視圖只在 iOS：Android 的回跳 intent 以 singleTask 重新帶起 MainActivity，Custom Tab 已被清掉；
  // 這時再呼叫 Browser.close() 會再開一個透明的 BrowserControllerActivity 蓋在 App 上（外掛只在 onNewIntent 處理 close），畫面看起來像當掉
  if (nativePlatform() === 'ios') await Browser.close().catch(() => { /* 視圖可能已經自己關了 */ });
  if (cb.failure) { emit(cb.failure); return; }
  if (!cb.code) { emit('failed'); return; }
  // WebView 重載後重播的舊回跳：session 早就換好了（supabase-js 會從儲存讀回），什麼都不做、也不報失敗
  if (cb.code === consumedCode()) { inFlight = false; return; }
  rememberConsumedCode(cb.code);
  try {
    const { error } = await supabase.auth.exchangeCodeForSession(cb.code);
    emit(error ? 'failed' : 'signed_in');
  } catch {
    emit('failed');
  }
}

/**
 * 註冊一次瀏覽器視圖關閉的監聽；App 啟動時由 shell.ts 呼叫。
 * appUrlOpen 與 getLaunchUrl 不在這裡登記：shell.ts 只登記一個 appUrlOpen 監聽，同一個網址同時交給 handleNativeAuthUrl 與 deeplink.ts
 * （Capacitor Android 把監聽登記前暫存的事件只給第一個監聽者，分開登記會吃掉對方的網址）。
 */
export async function initNativeAuth(): Promise<void> {
  if (listening) return;
  listening = true;
  // 使用者在瀏覽器視圖按「完成」／返回：沒有回跳就是取消。Android 上 browserFinished 一定比 appUrlOpen 早到，等一下再判斷
  await Browser.addListener('browserFinished', () => {
    if (!inFlight) return;
    setTimeout(() => { if (inFlight && !handled) emit('cancelled'); }, cancelGraceMs());
  });
}

export async function startNativeOAuth(provider: OAuthProvider): Promise<OAuthStart> {
  if (inFlight) return { ok: true };
  if (provider === 'apple' && nativePlatform() === 'ios') return startNativeAppleSignIn();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider,
    options: { redirectTo: NATIVE_AUTH_REDIRECT, skipBrowserRedirect: true },
  });
  if (error || !data.url) return { ok: false, reason: 'unavailable' };
  inFlight = true;
  handled = false;
  try {
    await Browser.open({ url: data.url });
  } catch {
    inFlight = false;
    return { ok: false, reason: 'unavailable' };
  }
  return { ok: true };
}

/**
 * iOS 的 Apple 登入走原生 Sign in with Apple（decisions D-5／D-7a）：系統表單拿 identity token，
 * 再用 signInWithIdToken 換 session，不開瀏覽器視圖。結果同樣經 emit → AuthContext，待辦動作（加入購物車等）照舊接著做；
 * 使用者關掉表單＝cancelled（不是錯誤）。Android 沒有 Apple 的原生 SDK，仍走上面的瀏覽器流程。
 * nonce：給 Apple 的是 SHA-256 過的值（原樣進 token 的 nonce claim），給 Supabase 的是原值（它自己 hash 後比對）。
 */
async function startNativeAppleSignIn(): Promise<OAuthStart> {
  const { SignInWithApple } = await import('@capacitor-community/apple-sign-in');
  const rawNonce = nonceFromBytes(crypto.getRandomValues(new Uint8Array(32)));
  const hashedNonce = await sha256Hex(rawNonce);
  inFlight = true;
  handled = false;
  let token: string | null;
  try {
    // clientId／redirectURI 只有外掛的網頁實作會用，iOS 原生表單不看；型別要求必填，給 bundle id 與登入回跳
    const { response } = await SignInWithApple.authorize({
      clientId: NATIVE_AUTH_SCHEME, redirectURI: NATIVE_AUTH_REDIRECT, scopes: 'email name', nonce: hashedNonce,
    });
    token = identityTokenOf(response);
  } catch (e) {
    emit(classifyAppleSignInError(e));
    return { ok: true };
  }
  if (!token) { emit('failed'); return { ok: true }; }
  try {
    const { error } = await supabase.auth.signInWithIdToken({ provider: 'apple', token, nonce: rawNonce });
    // bundle id 不在 Supabase Apple provider 的 Client IDs 時會在這裡失敗（audience 錯誤）；訊息留在 console 給真機驗收看
    if (error) console.warn('[native-auth] Apple signInWithIdToken 失敗：', error.message);
    emit(error ? 'failed' : 'signed_in');
  } catch {
    emit('failed');
  }
  return { ok: true };
}
