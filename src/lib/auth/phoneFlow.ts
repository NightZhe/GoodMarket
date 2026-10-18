import { nationalFromAuthPhone } from './phone';
import type { StorageLike } from './pending';

// R-25 離開再回來：S-10 期間，使用者會切到簡訊 App 看碼再切回來，頁面可能被 iOS 回收而重新載入。
// 這裡只保存「回到 S-10 需要知道的事」：整理後的門號、哪一步、上次傳送時間。
// **絕不保存驗證碼與 Turnstile token（R-7）**：序列化只挑白名單欄位，呼叫端塞了別的東西也不會寫進去。
// 只存在這個分頁（sessionStorage）；待辦動作另外由 pending.ts 保存。

export const FLOW_KEY = 'goodmarket_phone_flow';
/** 驗證碼有效時間（P9：5 分鐘）。超過就不再還原 S-10 */
export const FLOW_TTL_MS = 300_000;
/** 重新傳送要等的秒數（R-14 第 2 點，伺服器 max_frequency 也是 60 秒） */
export const RESEND_SECONDS = 60;

export interface PhoneFlow {
  /** E.164，例 +886912345678 */
  phone: string;
  step: 'login' | 'bind';
  /** 伺服器回 200 那一刻；null＝「我已經收到驗證碼」，沒有傳送過 */
  sentAt: number | null;
  /** 進入 S-10 的時間（sentAt 是 null 時用它算 300 秒） */
  savedAt: number;
}

export function serializeFlow(f: PhoneFlow): string {
  return JSON.stringify({ phone: f.phone, step: f.step, sentAt: f.sentAt, savedAt: f.savedAt });
}

const isTime = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0;

/** 讀回來的資料一律當作不可信；過期的也回 null */
export function parseFlow(raw: string | null, now: number): PhoneFlow | null {
  if (!raw) return null;
  let d: unknown;
  try { d = JSON.parse(raw); } catch { return null; }
  if (typeof d !== 'object' || d === null || Array.isArray(d)) return null;
  const o = d as Record<string, unknown>;
  if (typeof o.phone !== 'string' || !o.phone.startsWith('+') || nationalFromAuthPhone(o.phone) === null) return null;
  if (o.step !== 'login' && o.step !== 'bind') return null;
  if (!isTime(o.savedAt) || o.savedAt > now + 60_000) return null;
  if (o.sentAt !== null && !isTime(o.sentAt)) return null;
  if (o.sentAt !== null && (o.sentAt as number) > now + 60_000) return null;
  const f: PhoneFlow = { phone: o.phone, step: o.step, sentAt: o.sentAt as number | null, savedAt: o.savedAt };
  return now - (f.sentAt ?? f.savedAt) >= FLOW_TTL_MS ? null : f;
}

export function saveFlow(store: StorageLike | null, f: PhoneFlow): boolean {
  if (!store) return false;
  try { store.setItem(FLOW_KEY, serializeFlow(f)); return true; } catch { return false; }
}

export function clearFlow(store: StorageLike | null): void {
  if (!store) return;
  try { store.removeItem(FLOW_KEY); } catch { /* 刪不掉也沒有更多能做的 */ }
}

/** 取出還有效的狀態；壞掉或過期的順手刪掉 */
export function loadFlow(store: StorageLike | null, now: number): PhoneFlow | null {
  if (!store) return null;
  let raw: string | null = null;
  try { raw = store.getItem(FLOW_KEY); } catch { return null; }
  const f = parseFlow(raw, now);
  if (!f && raw) clearFlow(store);
  return f;
}

/** 這個分頁的 sessionStorage；被擋（隱私設定）就是 null，還原功能整個停用 */
export function flowStore(): StorageLike | null {
  try { return typeof sessionStorage === 'undefined' ? null : sessionStorage; } catch { return null; }
}

/**
 * 距離可以重新傳送還有幾秒。用保存的傳送時間算，不靠計時器累加：
 * iOS 背景分頁的計時器會被凍結，回到前景要立刻重算（visibilitychange／pageshow）。
 */
export function resendSecondsLeft(sentAt: number | null, now: number): number {
  if (sentAt === null) return 0;
  const left = Math.ceil((RESEND_SECONDS * 1000 - (now - sentAt)) / 1000);
  return Math.min(RESEND_SECONDS, Math.max(0, left));
}

// ───────── 這個門號上一次成功傳送的時間（只在記憶體）─────────
// over_sms_send_rate_limit 要靠它分兩種意思（60 秒內重寄／全站額度用完，phoneErrors.ts）。
// 「改用其他號碼」會清掉 R-25 的保存狀態，但同一個門號 60 秒內再傳還是會被擋，所以另外在記憶體記一份。
const recentSends = new Map<string, number>();

export function rememberSend(phone: string, at: number): void {
  recentSends.set(phone, at);
}

/** 沒有記錄（換分頁、重新整理）時，若 R-25 保存的是同一個門號就用保存的時間 */
export function lastSendAt(phone: string, stored: PhoneFlow | null): number | null {
  const mem = recentSends.get(phone);
  if (mem !== undefined) return mem;
  return stored && stored.phone === phone ? stored.sentAt : null;
}

/** 這一頁本身就是登入閘門（沒登入時頁面就是登入畫面）：閘門自己會還原 S-10，不需要再自動開一個面板 */
export const isGateRoute = (route: string): boolean => /^\/(cart|checkout|orders|account|seller)(\/|$)/.test(route);
