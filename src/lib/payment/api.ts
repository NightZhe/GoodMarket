import { FunctionsFetchError, FunctionsHttpError } from '@supabase/supabase-js';
import { supabase } from '../supabase';
import { fail, rpc } from '../account/api';
import { AccountError, accountErrorText } from '../account/errors';
import { parseCheckedOrder } from '../account/priceCheck';
import type { BuyerOrderRow } from '../supabase';
import type { CheckoutRejection } from '../../types';
import { PaymentError, parseErrorBody, paymentErrorText } from './errors';
import type {
  BindConfirmResponse, BindStartResponse, BindStatusResponse, BuyerCancelReason, MethodDeleteResponse, OrderPaymentRow, OrderRefundRow, PayResponse,
  PaymentGroupView, PaymentMethodRow, PaymentStatusResponse, PlaceOnlineOrderArgs, PlaceOnlineOrderOk, RequestCancelResult, RespondCancelResult,
  SellerCancelReason, SellerEcpayMerchantRow, SellerOrderPayoutRow, ShopCancelSummary, ShopOnlinePayable, ShopOrderRefundRow,
} from './types';
import { chunkIds } from './payoutView';
import { parseLogosEnabled } from '../../data/bankLogos';
import { parseBankAccountList, type AddBankRequest, type BankAccountList } from './bankAccount';

// 線上付款的前端呼叫（介面見 .work/account-payment-methods/interface-payment.md）。
// 前端永遠碰不到 BindCardID、卡號、HashKey：卡號只輸入在綠界的欄位，這裡只傳「綁卡編號」與綠界 SDK 給的一次性代碼。

const DEFAULT_TIMEOUT_MS = 30_000;

/** 呼叫 Edge Function（POST、JSON、自動帶登入 token）。非 2xx 轉成 PaymentError（錯誤內容在 error.context 的 body） */
async function call<T>(name: string, body: Record<string, unknown>, timeoutMs: number | null = DEFAULT_TIMEOUT_MS): Promise<T> {
  const { data, error } = await supabase.functions.invoke(name, { body, ...(timeoutMs ? { timeout: timeoutMs } : {}) });
  if (error) {
    if (error instanceof FunctionsHttpError) {
      const res = error.context as Response;
      let parsed: unknown = null;
      try { parsed = await res.json(); } catch { /* 不是 JSON：交給 parseErrorBody 當作看不懂的回應 */ }
      throw parseErrorBody(parsed, res.status);
    }
    // 連不上、逾時被中止（FunctionsFetchError）與其他：沒有伺服器回應
    throw new PaymentError(error instanceof FunctionsFetchError ? '連線失敗' : error.message, 'network', null, null);
  }
  const out = data as { ok?: boolean } | null;
  if (!out || out.ok !== true) throw parseErrorBody(out, null);
  return out as T;
}

// ── 開關 ──
export async function fetchPaymentConfig(): Promise<boolean> {
  const { data, error } = await supabase.rpc('get_payment_config');
  if (error) return fail(error);
  return Boolean((data as { onlinePaymentEnabled?: boolean } | null)?.onlinePaymentEnabled);
}

/** 銀行 logo 的伺服器端開關（get_bank_ui_config）。讀不到、舊資料庫、不是明確的 true：一律當作關（純文字） */
export async function fetchBankLogosEnabled(): Promise<boolean> {
  const { data, error } = await supabase.rpc('get_bank_ui_config');
  return !error && parseLogosEnabled(data);
}

// ── 卡片 ──
export async function fetchPaymentMethods(): Promise<PaymentMethodRow[]> {
  const { data, error } = await supabase.from('my_payment_methods').select('*');
  if (error) return fail(error);
  const rows = data as PaymentMethodRow[];
  // 預設那張排第一，其餘依綁定時間
  return [...rows].sort((a, b) => Number(b.is_default) - Number(a.is_default) || a.created_at.localeCompare(b.created_at));
}

export const setDefaultMethod = (id: string) => rpc<null>('set_default_payment_method', { p_id: id });
export const deleteMethod = (id: string) => call<MethodDeleteResponse>('payment-method-delete', { id });

// ── 綁卡 ──
export const bindStart = (returnPath?: string) => call<BindStartResponse>('payment-bind-start', returnPath ? { returnPath } : {});
export const bindConfirm = (merchantTradeNo: string, bindCardPayToken: string) =>
  call<BindConfirmResponse>('payment-bind-confirm', { merchantTradeNo, bindCardPayToken });
export const bindStatus = (merchantTradeNo: string) => call<BindStatusResponse>('payment-bind-status', { merchantTradeNo });

// ── 結帳與付款 ──
export const fetchShopsOnlinePayable = async (shopIds: string[]): Promise<Record<string, boolean>> => {
  const rows = await rpc<ShopOnlinePayable[]>('get_shops_online_payable', { p_shop_ids: shopIds });
  return Object.fromEntries(rows.map(r => [r.shop_id, r.online_payable]));
};

export type PlaceOnlineResult =
  | { outcome: 'ok'; orders: BuyerOrderRow[]; payGroupId: string; payTotal: number; expiresAt: string; onlineOrderIds: string[] }
  | { outcome: 'rejected'; changes: CheckoutRejection[] };

/** 比價、庫存、運費規則與 place_checked_order 完全一樣；rejected 時什麼都沒建 */
export async function placeOnlineOrder(a: PlaceOnlineOrderArgs): Promise<PlaceOnlineResult> {
  const raw = await rpc<unknown>('place_online_order', { ...a });
  const checked = parseCheckedOrder<BuyerOrderRow>(raw);
  if (checked.outcome === 'rejected') return checked;
  const ok = raw as PlaceOnlineOrderOk;
  if (typeof ok.payGroupId !== 'string' || !Array.isArray(ok.onlineOrderIds)) {
    throw new AccountError('unexpected place_online_order response', 'server', null);
  }
  return { outcome: 'ok', orders: checked.orders, payGroupId: ok.payGroupId, payTotal: ok.payTotal, expiresAt: ok.expiresAt, onlineOrderIds: ok.onlineOrderIds };
}

/** 一次請求最多可能跑數十秒（每家店各授權一筆），所以不設逾時；結帳頁自己在 45 秒後轉去確認中頁 */
export const payGroup = (groupId: string, paymentMethodId: string) =>
  call<PayResponse>('payment-pay', { groupId, paymentMethodId }, null);

export const fetchPaymentStatus = async (groupId: string): Promise<PaymentGroupView> =>
  (await call<PaymentStatusResponse>('payment-status', { groupId })).group;

export const fetchOrderPayments = () => rpc<OrderPaymentRow[]>('get_order_payments');
export const expireMyPendingOrders = () => rpc<number>('expire_my_pending_orders');

// ── 賣家收款帳戶 ──
export async function fetchMyMerchant(): Promise<SellerEcpayMerchantRow | null> {
  const { data, error } = await supabase.from('seller_ecpay_merchants').select('*').maybeSingle();
  if (error) return fail(error);
  return (data as SellerEcpayMerchantRow | null) ?? null;
}
export const submitMerchantId = (id: string) => rpc<{ status: string }>('submit_seller_ecpay_merchant', { p_merchant_id: id });

// ── 銀行帳號（掛人、最多 5 筆、不可修改；介面見 .work/seller-bank-account/interface-bank-account-v2.md）──
// 前端拿不到完整帳號與密文：讀只有摘要；新增時整串明文只走「瀏覽器 → bank-account-add」這一段，這裡不記錄、不快取。
/** 讀列表。RPC 不存在（資料庫未升級）→ AccountError 'backend_missing'；沒登入 → 'auth' */
export async function fetchMyBankAccounts(): Promise<BankAccountList> {
  const { data, error } = await supabase.rpc('get_my_bank_accounts');
  if (error) return fail(error);
  return parseBankAccountList(data);
}

/** 新增；成功回「更新後的完整列表」與新帳號 id。Edge Function 錯誤→PaymentError（code 是契約 3.2 的碼） */
export async function addBankAccount(input: AddBankRequest): Promise<{ id: string; list: BankAccountList }> {
  const out = await call<{ ok: true; id?: unknown; limit?: unknown; accounts?: unknown }>('bank-account-add', { ...input });
  if (typeof out.id !== 'string') throw new PaymentError('bank-account-add: bad response', 'server', null, null);
  return { id: out.id, list: parseBankAccountList({ limit: out.limit, accounts: out.accounts }) };
}

/** 設為撥款帳號（簡訊再驗證由資料庫讀 JWT）；回更新後的完整列表 */
export async function setPayoutBankAccount(id: string): Promise<BankAccountList> {
  const { data, error } = await supabase.rpc('set_payout_bank_account', { p_id: id });
  if (error) return fail(error);
  return parseBankAccountList(data);
}

export async function deleteBankAccount(id: string): Promise<BankAccountList> {
  const { data, error } = await supabase.rpc('delete_my_bank_account', { p_id: id });
  if (error) return fail(error);
  return parseBankAccountList(data);
}

// ── 退款：已付款線上訂單的取消（介面 8.1、8.2；全部是 RPC，沒有 Edge Function）──
const noteOrNull = (note: string | null | undefined): string | null => note?.trim() || null;

export const requestOrderCancel = (orderId: string, reason: BuyerCancelReason, note?: string | null) =>
  rpc<RequestCancelResult>('request_order_cancel', { p_order: orderId, p_reason: reason, p_note: noteOrNull(note) });
export const withdrawOrderCancel = (orderId: string) => rpc<{ outcome: 'withdrawn' }>('withdraw_order_cancel', { p_order: orderId });
export const acceptOrderCancel = (orderId: string) => rpc<RespondCancelResult>('respond_order_cancel', { p_order: orderId, p_accept: true });
export const rejectOrderCancel = (orderId: string, rejectReason: string) =>
  rpc<RespondCancelResult>('respond_order_cancel', { p_order: orderId, p_accept: false, p_reject_reason: rejectReason.trim() });
export const sellerCancelPaidOrder = (orderId: string, reason: SellerCancelReason, note?: string | null) =>
  rpc<{ outcome: 'refunding' }>('seller_cancel_paid_order', { p_order: orderId, p_reason: reason, p_note: noteOrNull(note) });

export const fetchMyOrderRefunds = async () => (await rpc<OrderRefundRow[] | null>('get_my_order_refunds')) ?? [];
export const fetchShopOrderRefunds = async () => (await rpc<ShopOrderRefundRow[] | null>('get_shop_order_refunds')) ?? [];
export const fetchShopCancelSummary = () => rpc<ShopCancelSummary>('get_shop_cancel_summary');

/** 賣家訂單頁的撥款狀態：整頁的訂單一次請求（AC-R24），超過 200 張才分批 */
export async function fetchSellerOrderPayouts(orderIds: string[]): Promise<SellerOrderPayoutRow[]> {
  const parts = await Promise.all(chunkIds(orderIds).map(ids => rpc<SellerOrderPayoutRow[] | null>('get_seller_order_payouts', { p_order_ids: ids })));
  return parts.flatMap(rows => rows ?? []);
}

// ── 錯誤 ──
/** 兩條路的錯誤（Edge Function 的 PaymentError、RPC 的 AccountError）統一取代碼與文字 */
export const errorCodeOf = (e: unknown): string | null =>
  e instanceof PaymentError || e instanceof AccountError ? e.code : null;

export const isAuthError = (e: unknown): boolean =>
  (e instanceof PaymentError || e instanceof AccountError) && e.kind === 'auth';

export function payErrorText(e: unknown, fallback: string): string {
  if (e instanceof PaymentError) return paymentErrorText(e, fallback);
  const code = errorCodeOf(e);
  const known = code ? paymentErrorText(new PaymentError('', 'server', code, null), '') : '';
  return known || accountErrorText(e, fallback);
}

/** 收款帳戶的後端還沒升級：RPC 不存在（PGRST202）或 Edge Function 404。畫面顯示「收款帳戶暫時無法使用」，不退回舊表單 */
export const isBankUnavailable = (e: unknown): boolean =>
  (e instanceof AccountError && e.kind === 'backend_missing') || (e instanceof PaymentError && e.status === 404);
