import { App } from '@capacitor/app';
import { Browser } from '@capacitor/browser';
import { supabase } from '../supabase';
import type { OAuthProvider, OAuthStart } from '../auth/oauth';
import { NATIVE_AUTH_EVENT, NATIVE_AUTH_REDIRECT, parseNativeCallback, type NativeAuthOutcome } from './callback';

// App 內的 Google／Apple 登入（decisions.md D-4）。
// Google 擋嵌入式 WebView，所以不能在 App 的 WebView 裡整頁跳轉；改成：
//   1. signInWithOAuth 只拿網址（skipBrowserRedirect），redirectTo 是自訂 scheme
//   2. 用系統瀏覽器視圖開它（iOS SFSafariViewController、Android Custom Tabs）
//   3. Supabase 302 回自訂 scheme → appUrlOpen 收到 ?code= → 用 PKCE 換 session（verifier 在 WebView 的儲存，與發動端同一個）
//   4. 關掉瀏覽器視圖；結果用 window 事件通知 AuthContext（同一頁完成，像手機簡訊登入那樣不會重新載入）

let inFlight = false;
let handled = false;
let listening = false;

function emit(outcome: NativeAuthOutcome) {
  inFlight = false;
  window.dispatchEvent(new CustomEvent<NativeAuthOutcome>(NATIVE_AUTH_EVENT, { detail: outcome }));
}

async function onUrlOpen(url: string) {
  const cb = parseNativeCallback(url);
  if (!cb) return;
  handled = true;
  await Browser.close().catch(() => { /* Android 的 Custom Tab 可能已經自己關了 */ });
  if (cb.failure) { emit(cb.failure); return; }
  if (!cb.code) { emit('failed'); return; }
  try {
    const { error } = await supabase.auth.exchangeCodeForSession(cb.code);
    emit(error ? 'failed' : 'signed_in');
  } catch {
    emit('failed');
  }
}

/** 註冊一次 deep link 與瀏覽器關閉的監聽；App 啟動時由 shell.ts 呼叫 */
export async function initNativeAuth(): Promise<void> {
  if (listening) return;
  listening = true;
  await App.addListener('appUrlOpen', e => { void onUrlOpen(e.url); });
  // 使用者在瀏覽器視圖按「完成」／返回：沒有回跳就是取消。Android 上 browserFinished 可能比 appUrlOpen 早到，等一下再判斷
  await Browser.addListener('browserFinished', () => {
    if (!inFlight) return;
    setTimeout(() => { if (inFlight && !handled) emit('cancelled'); }, 600);
  });
  // 冷啟動是由回跳網址喚起時，appUrlOpen 也會送，但保險起見再查一次
  const launch = await App.getLaunchUrl().catch(() => null);
  if (launch?.url) void onUrlOpen(launch.url);
}

export async function startNativeOAuth(provider: OAuthProvider): Promise<OAuthStart> {
  if (inFlight) return { ok: true };
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
