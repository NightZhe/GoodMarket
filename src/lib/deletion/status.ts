import { toAccountError } from '../account/errors';
import type { DeletionRequest, DeletionStatus } from './api';

// 把資料庫回的狀態（或錯誤）映成申請頁的畫面狀態。純函式，不碰網路與 DOM。
// 規則（介面契約 §1.4）：有處理中的申請 → pending；否則買家身分有未完成訂單，或有店且店內有未完成訂單 → blocked_orders；其餘 can_apply。
// 讀不到（network／server）→ error，絕不顯示成可申請。

export type DeletionView =
  | { kind: 'can_apply'; hasShop: boolean }
  | { kind: 'pending'; request: DeletionRequest; hasShop: boolean }
  | { kind: 'blocked_orders'; hasShop: boolean; buyerOrders: number; shopOrders: number }
  | { kind: 'error' }
  | { kind: 'backend_missing' }
  | { kind: 'auth' };

export function viewOfStatus(s: DeletionStatus): DeletionView {
  if (s.request) return { kind: 'pending', request: s.request, hasShop: s.has_shop };
  const shopOrders = s.has_shop ? s.unfinished_shop_orders : 0;
  if (s.unfinished_buyer_orders > 0 || shopOrders > 0) {
    return { kind: 'blocked_orders', hasShop: s.has_shop, buyerOrders: s.unfinished_buyer_orders, shopOrders };
  }
  return { kind: 'can_apply', hasShop: s.has_shop };
}

export function viewOfError(e: unknown): DeletionView {
  const kind = toAccountError(e).kind;
  if (kind === 'auth') return { kind: 'auth' };
  if (kind === 'backend_missing') return { kind: 'backend_missing' };
  return { kind: 'error' };
}

/** 申請頁現在該畫哪一種（登入狀態＋讀到的狀態合起來看） */
export type Stage = 'loading' | 'login' | 'login_expired' | DeletionView['kind'];

/**
 * 還在判斷登入、或已登入但還沒讀到狀態＝loading。未登入：登入過期（sessionExpired）與一般未登入分開。
 * 已登入但送出／取消時被告知登入失效（authLost），或讀狀態得到 auth：同樣是登入過期。
 */
export function stageOf(i: { authReady: boolean; signedIn: boolean; sessionExpired: boolean; authLost: boolean; view: DeletionView | null }): Stage {
  if (!i.authReady) return 'loading';
  if (!i.signedIn) return i.sessionExpired ? 'login_expired' : 'login';
  if (i.authLost || i.view?.kind === 'auth') return 'login_expired';
  return i.view === null ? 'loading' : i.view.kind;
}

/** 頁面上有沒有「有店」的資訊：只有讀到狀態的畫面才知道 */
export const hasShopOf = (v: DeletionView | null): boolean =>
  v !== null && (v.kind === 'can_apply' || v.kind === 'pending' || v.kind === 'blocked_orders') && v.hasShop;

/** 帳號頁那一列：只有「處理中」才改成雙行；其他（含讀不到）都只顯示「刪除帳號」 */
export const pendingOf = (v: DeletionView | null): DeletionRequest | null => (v?.kind === 'pending' ? v.request : null);

// ── 送出／取消申請失敗後怎麼辦 ──

export type ActionKind = 'request' | 'cancel';

export interface ActionFailure {
  /** auth＝登入過期（S-D11）；backend_missing＝S-D12；refresh＝重讀狀態並照新狀態畫面；toast 是要說的話 */
  next: 'auth' | 'backend_missing' | 'refresh';
  toast: { message: string; kind: 'info' | 'error' } | null;
}

/**
 * 只有資料庫自己定的中文訊息（有 hint 的 server 錯誤）才直接顯示；英文原文、網路錯誤一律用固定中文（AC-X5）。
 * 失敗後都要重讀狀態（refresh）：伺服器可能已經收下了，不能只靠這次的回應猜。
 */
export function failureOf(action: ActionKind, e: unknown): ActionFailure {
  const err = toAccountError(e);
  if (err.kind === 'auth') return { next: 'auth', toast: null };
  if (err.kind === 'backend_missing') return { next: 'backend_missing', toast: null };
  const dbMessage = err.kind === 'server' && err.code && err.message ? err.message : null;
  if (action === 'request') {
    if (err.code === 'DELETION_ALREADY_REQUESTED') return { next: 'refresh', toast: { message: dbMessage ?? '你已經申請過刪除帳號，正在處理中', kind: 'info' } };
    if (err.code === 'DELETION_ORDERS_UNFINISHED' || err.code === 'DELETION_SHOP_ORDERS_UNFINISHED') {
      return { next: 'refresh', toast: { message: dbMessage ?? '你還有待出貨或運送中的訂單，完成或取消後才能申請刪除帳號', kind: 'error' } };
    }
    return { next: 'refresh', toast: { message: '沒有送出成功，請檢查網路後再試一次。', kind: 'error' } };
  }
  if (err.code === 'DELETION_NOT_PENDING') return { next: 'refresh', toast: { message: '沒有處理中的刪除申請', kind: 'info' } };
  return { next: 'refresh', toast: { message: '取消失敗，請檢查網路後再試', kind: 'error' } };
}
