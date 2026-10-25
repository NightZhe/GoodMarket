import { App } from '@capacitor/app';
import { Browser } from '@capacitor/browser';
import { parseNativeCaptchaCallback } from './captchaUrl';

// 方案 B：App 內用系統瀏覽器視圖（iOS SFSafariViewController）開正式站 captcha.html 做 Turnstile，
// 通過後自訂 scheme 回跳 io.github.nightzhe.goodmarket://captcha?token=… 帶回一次性的 token（300 秒內要用掉）。
// 做法照 auth.ts 的登入回跳：Browser.open → appUrlOpen 收 token → Browser.close；瀏覽器視圖被關掉而沒有回跳＝取消。
// 只由 useTurnstile 在原生 iOS 動態載入，網頁 bundle 不含這些外掛。

export type NativeCaptchaResult = { ok: true; token: string } | { ok: false; reason: 'cancelled' | 'unavailable' };

let listening = false;
let pending: { resolve: (r: NativeCaptchaResult) => void } | null = null;

function settle(r: NativeCaptchaResult) {
  const p = pending;
  pending = null;
  p?.resolve(r);
}

async function onUrlOpen(url: string) {
  const cb = parseNativeCaptchaCallback(url);
  if (!cb || !pending) return;
  await Browser.close().catch(() => { /* 可能已經關了 */ });
  settle(cb.token ? { ok: true, token: cb.token } : { ok: false, reason: 'cancelled' });
}

async function listen(): Promise<void> {
  if (listening) return;
  listening = true;
  await App.addListener('appUrlOpen', e => { void onUrlOpen(e.url); });
  // 使用者按「完成」：沒有回跳就是取消。回跳可能比 browserFinished 晚一點到，等一下再判斷
  await Browser.addListener('browserFinished', () => {
    if (!pending) return;
    setTimeout(() => { if (pending) settle({ ok: false, reason: 'cancelled' }); }, 600);
  });
}

/** 開安全驗證頁，等回跳。同時只會有一次；再呼叫會把前一次當取消 */
export async function runNativeCaptcha(url: string): Promise<NativeCaptchaResult> {
  await listen();
  if (pending) settle({ ok: false, reason: 'cancelled' });
  const result = new Promise<NativeCaptchaResult>(resolve => { pending = { resolve }; });
  try {
    await Browser.open({ url });
  } catch {
    settle({ ok: false, reason: 'unavailable' });
  }
  return result;
}
