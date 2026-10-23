import type { StorageLike } from '../../lib/auth/pending';

// 「我的」頁未登入時，按「我的訂單／購物車／地址」要先登入、登入後到那一頁。
// 手機號碼驗證在同一頁完成（頁面狀態還在），但 Google／Apple 是整頁轉址，回來之後頁面狀態全沒了，
// 所以目標也暫存在 sessionStorage（跟著分頁）。取用就是刪除；取消登入由呼叫端 clearGoto。
// 沒有走 lib/auth/pending 的 goto 待辦動作：它只會回到「按下時所在的頁」（也就是 /account），帶不到別的頁。

export const GOTO_KEY = 'goodmarket_account_goto';
/** 登入轉址一來一回的上限；超過就不再自動導頁（使用者早已忘了當初想去哪） */
export const GOTO_TTL_MS = 10 * 60 * 1000;

/** 只放行「我的」頁上要登入的三個入口，不接受任意路徑 */
const TARGETS: readonly string[] = ['/orders', '/cart', '/account/addresses'];

/** 回傳 false＝瀏覽器擋住暫存（Google／Apple 轉址回來後無法導頁；同頁完成的手機登入不受影響） */
export function rememberGoto(store: StorageLike, to: string, now: number): boolean {
  if (!TARGETS.includes(to)) return false;
  try {
    store.setItem(GOTO_KEY, JSON.stringify({ to, at: now }));
    return true;
  } catch {
    return false;
  }
}

export function clearGoto(store: StorageLike): void {
  try { store.removeItem(GOTO_KEY); } catch { /* 刪不掉也沒有更多能做的；下一次取用會因逾時而作廢 */ }
}

/** 取用：讀出來並立刻刪掉。過期、壞資料、不在放行清單的都回 null */
export function takeGoto(store: StorageLike, now: number): string | null {
  let raw: string | null = null;
  try { raw = store.getItem(GOTO_KEY); } catch { /* 讀不到就當作沒有 */ }
  clearGoto(store);
  if (!raw) return null;
  let data: unknown;
  try { data = JSON.parse(raw); } catch { return null; }
  if (typeof data !== 'object' || data === null) return null;
  const { to, at } = data as { to?: unknown; at?: unknown };
  if (typeof to !== 'string' || !TARGETS.includes(to)) return null;
  if (typeof at !== 'number' || !Number.isFinite(at) || now - at >= GOTO_TTL_MS || at > now) return null;
  return to;
}
