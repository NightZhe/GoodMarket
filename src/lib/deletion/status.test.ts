import { describe, expect, it } from 'vitest';
import { AccountError } from '../account/errors';
import type { DeletionRequest, DeletionStatus } from './api';
import { failureOf, hasShopOf, pendingOf, stageOf, viewOfError, viewOfStatus, type DeletionView } from './status';

const REQ: DeletionRequest = { id: 'r1', status: 'pending', requested_at: '2026-10-25T11:36:08+00:00', due_date: '2026-11-03' };
const status = (o: Partial<DeletionStatus> = {}): DeletionStatus => ({ request: null, has_shop: false, unfinished_buyer_orders: 0, unfinished_shop_orders: 0, ...o });
const dbError = (code: string, message: string) => new AccountError(message, 'server', code);

describe('viewOfStatus：回傳映成畫面狀態', () => {
  it('沒申請、沒未完成訂單 → 可申請', () => {
    expect(viewOfStatus(status())).toEqual({ kind: 'can_apply', hasShop: false });
    expect(viewOfStatus(status({ has_shop: true }))).toEqual({ kind: 'can_apply', hasShop: true });
  });
  it('有處理中的申請 → pending，即使同時有未完成訂單（申請後又下單，R-D4）', () => {
    expect(viewOfStatus(status({ request: REQ }))).toEqual({ kind: 'pending', request: REQ, hasShop: false });
    expect(viewOfStatus(status({ request: REQ, unfinished_buyer_orders: 2 })).kind).toBe('pending');
  });
  it('買家身分有未完成訂單 → 擋訂單，帶筆數', () => {
    expect(viewOfStatus(status({ unfinished_buyer_orders: 3 }))).toEqual({ kind: 'blocked_orders', hasShop: false, buyerOrders: 3, shopOrders: 0 });
  });
  it('有店且店內有未完成訂單 → 擋訂單；買家與店內可同時有', () => {
    expect(viewOfStatus(status({ has_shop: true, unfinished_shop_orders: 2 }))).toEqual({ kind: 'blocked_orders', hasShop: true, buyerOrders: 0, shopOrders: 2 });
    expect(viewOfStatus(status({ has_shop: true, unfinished_buyer_orders: 1, unfinished_shop_orders: 2 }))).toEqual({ kind: 'blocked_orders', hasShop: true, buyerOrders: 1, shopOrders: 2 });
  });
  it('沒有店時店內筆數不算（契約：沒有店就是 0；防呆）', () => {
    expect(viewOfStatus(status({ has_shop: false, unfinished_shop_orders: 5 })).kind).toBe('can_apply');
  });
});

describe('viewOfError：錯誤映成畫面狀態，讀不到絕不是可申請', () => {
  it('auth／backend_missing／network／server', () => {
    expect(viewOfError(new AccountError('請先登入', 'auth', 'NOT_AUTHENTICATED')).kind).toBe('auth');
    expect(viewOfError(new AccountError('Could not find the function', 'backend_missing', null)).kind).toBe('backend_missing');
    expect(viewOfError(new AccountError('Failed to fetch', 'network', null)).kind).toBe('error');
    expect(viewOfError(dbError('X', 'y')).kind).toBe('error');
  });
  it('不是 AccountError 的例外也分類（斷線的 TypeError）', () => {
    expect(viewOfError(new TypeError('Load failed')).kind).toBe('error');
  });
});

describe('stageOf：登入狀態與讀到的狀態合起來看', () => {
  const base = { authReady: true, signedIn: true, sessionExpired: false, authLost: false, view: null as DeletionView | null };
  it('登入狀態還不知道、或已登入還沒讀到 → loading', () => {
    expect(stageOf({ ...base, authReady: false, signedIn: false })).toBe('loading');
    expect(stageOf(base)).toBe('loading');
  });
  it('未登入：一般 login；登入過期 login_expired（不讀狀態）', () => {
    expect(stageOf({ ...base, signedIn: false })).toBe('login');
    expect(stageOf({ ...base, signedIn: false, sessionExpired: true })).toBe('login_expired');
  });
  it('已登入但資料庫說登入失效（讀狀態或送出時）→ login_expired', () => {
    expect(stageOf({ ...base, view: { kind: 'auth' } })).toBe('login_expired');
    expect(stageOf({ ...base, authLost: true, view: { kind: 'can_apply', hasShop: false } })).toBe('login_expired');
  });
  it('其餘照讀到的狀態', () => {
    for (const view of [{ kind: 'can_apply', hasShop: false }, { kind: 'error' }, { kind: 'backend_missing' }] as DeletionView[]) {
      expect(stageOf({ ...base, view })).toBe(view.kind);
    }
  });
});

describe('帳號頁那一列', () => {
  it('只有 pending 才有申請；讀不到、可申請、擋訂單、沒讀過都沒有', () => {
    expect(pendingOf({ kind: 'pending', request: REQ, hasShop: false })).toBe(REQ);
    for (const v of [null, { kind: 'error' }, { kind: 'backend_missing' }, { kind: 'auth' }, { kind: 'can_apply', hasShop: true }] as (DeletionView | null)[]) {
      expect(pendingOf(v)).toBeNull();
    }
  });
  it('hasShopOf：只有讀到狀態的畫面才知道', () => {
    expect(hasShopOf(null)).toBe(false);
    expect(hasShopOf({ kind: 'error' })).toBe(false);
    expect(hasShopOf({ kind: 'can_apply', hasShop: true })).toBe(true);
  });
});

describe('failureOf：送出／取消失敗後怎麼辦（AC-X5：不出現英文原文）', () => {
  it('登入失效、資料庫未升級 → 換畫面，不跳 toast', () => {
    for (const a of ['request', 'cancel'] as const) {
      expect(failureOf(a, new AccountError('請先登入', 'auth', 'NOT_AUTHENTICATED'))).toEqual({ next: 'auth', toast: null });
      expect(failureOf(a, new AccountError('Could not find the function', 'backend_missing', null))).toEqual({ next: 'backend_missing', toast: null });
    }
  });
  it('已申請過 → 重讀並用資料庫的中文訊息（info）', () => {
    expect(failureOf('request', dbError('DELETION_ALREADY_REQUESTED', '你已經申請過刪除帳號，正在處理中')))
      .toEqual({ next: 'refresh', toast: { message: '你已經申請過刪除帳號，正在處理中', kind: 'info' } });
  });
  it('有未完成訂單（買家／店內）→ 重讀並顯示資料庫訊息（error）', () => {
    const m = '你還有待出貨或運送中的訂單，完成或取消後才能申請刪除帳號';
    expect(failureOf('request', dbError('DELETION_ORDERS_UNFINISHED', m))).toEqual({ next: 'refresh', toast: { message: m, kind: 'error' } });
    const s = '你的店還有待出貨或運送中的訂單，處理完成後才能申請刪除帳號';
    expect(failureOf('request', dbError('DELETION_SHOP_ORDERS_UNFINISHED', s))).toEqual({ next: 'refresh', toast: { message: s, kind: 'error' } });
  });
  it('網路中斷、不認得的錯誤 → 固定中文，英文原文不外露；一律重讀', () => {
    const net = new AccountError('Failed to fetch', 'network', null);
    expect(failureOf('request', net)).toEqual({ next: 'refresh', toast: { message: '沒有送出成功，請檢查網路後再試一次。', kind: 'error' } });
    expect(failureOf('request', new AccountError('duplicate key value violates unique constraint', 'server', null)).toast?.message)
      .toBe('沒有送出成功，請檢查網路後再試一次。');
    expect(failureOf('cancel', net)).toEqual({ next: 'refresh', toast: { message: '取消失敗，請檢查網路後再試', kind: 'error' } });
  });
  it('取消時沒有處理中的申請 → 重讀並說明（info）', () => {
    expect(failureOf('cancel', dbError('DELETION_NOT_PENDING', '沒有處理中的刪除申請')))
      .toEqual({ next: 'refresh', toast: { message: '沒有處理中的刪除申請', kind: 'info' } });
  });
});
