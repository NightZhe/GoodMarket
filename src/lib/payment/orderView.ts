import type { Order, OrderStatus } from '../../types';
import { brandLabel } from './cards';
import type { CancelRequestView, OrderPaymentRow } from './types';

// 訂單上的付款資訊。歷史的 'card'（示範時期）永遠不是已付款（R-B12）；賣家只會讀到已付款的線上單（待付款被資料庫過濾）。

export const BUYER_PAY_LABEL: Record<Order['payment'], string> = {
  cod: '貨到付款', card: '信用卡（示範）', transfer: 'ATM 轉帳（示範）', ecpay_card: '信用卡',
};

export const SELLER_PAY_LABEL: Record<Order['payment'], string> = {
  cod: '貨到付款', card: '信用卡（示範）', transfer: 'ATM 轉帳（示範）', ecpay_card: '信用卡・已付款',
};

export type OrderPayState = 'cod' | 'demo' | 'paid' | 'pending' | 'confirming' | 'expired' | 'refunding' | 'refunded' | 'unknown';

/** 買家訂單的付款狀態。線上付款以 get_order_payments 為準；還沒讀到付款資訊時是 unknown（不能顯示成已付款） */
export function orderPayState(payment: Order['payment'], pay: OrderPaymentRow | undefined): OrderPayState {
  if (payment === 'cod') return 'cod';
  if (payment !== 'ecpay_card') return 'demo';
  if (!pay) return 'unknown';
  switch (pay.payment_status) {
    case 'paid': return 'paid';
    case 'pending': return 'pending';
    case 'confirming': return 'confirming';
    case 'refunding': return 'refunding';
    case 'refunded': return 'refunded';
    case 'expired':
    case 'failed': return 'expired';
    default: return 'unknown';
  }
}

const PAID_TAIL = { paid: '已付款', refunding: '退款處理中', refunded: '已退款' } as const;

/** 訂單卡 footer 的付款方式一行字（設計 10.1；退款中、已退款換結尾字，退款設計 4.1） */
export function orderPayLine(payment: Order['payment'], pay: OrderPaymentRow | undefined): string {
  const state = orderPayState(payment, pay);
  if ((state === 'paid' || state === 'refunding' || state === 'refunded') && pay) {
    const brand = pay.card_brand ? `${brandLabel(pay.card_brand)} ` : '';
    return `信用卡 ${brand}•••• ${pay.card4 ?? ''}・${PAID_TAIL[state]}`;
  }
  return BUYER_PAY_LABEL[payment];
}

/** 同一批（同付款群組）仍待付款的訂單，含自己。沒有群組編號的舊資料只有自己 */
export function pendingBatch<T extends { id: string }>(orderId: string, pays: OrderPaymentRow[], orders: T[]): T[] {
  const mine = pays.find(p => p.order_id === orderId);
  if (!mine?.group_id) return orders.filter(o => o.id === orderId);
  const ids = new Set(pays.filter(p => p.group_id === mine.group_id && p.payment_status === 'pending').map(p => p.order_id));
  return orders.filter(o => ids.has(o.id));
}

/** 同一次付款（同付款群組）是否還有其他訂單。申請取消對話框據此決定要不要寫「同一次付款的其他訂單不受影響」（R-RF7） */
export function hasBatchSiblings(orderId: string, pays: OrderPaymentRow[]): boolean {
  const mine = pays.find(p => p.order_id === orderId);
  return Boolean(mine?.group_id) && pays.some(p => p.group_id === mine!.group_id && p.order_id !== orderId);
}

/** 買家訂單 footer 的付款方式一行：開關關著時整行不出現（畫面與沒有線上付款功能時逐字相同） */
export const orderPayLineIfOn = (onlineOn: boolean, payment: Order['payment'], pay: OrderPaymentRow | undefined): string | null =>
  onlineOn ? orderPayLine(payment, pay) : null;

/** 開關關著時賣家看到的標籤：維持上線前的字（沒有「（示範）」）。已存在的線上付款單一律「信用卡・已付款」，不受開關影響；退款中、已退款只換結尾 */
const SELLER_LEGACY_LABEL: Record<Order['payment'], string> = { cod: '貨到付款', card: '信用卡', transfer: 'ATM 轉帳', ecpay_card: SELLER_PAY_LABEL.ecpay_card };
export const sellerPayLabel = (payment: Order['payment'], onlineOn: boolean, refund?: 'refunding' | 'refunded' | null): string =>
  payment === 'ecpay_card' && refund ? `信用卡・${PAID_TAIL[refund]}` : (onlineOn ? SELLER_PAY_LABEL : SELLER_LEGACY_LABEL)[payment];

/**
 * 買家訂單的取消區（退款設計 8 第 2 點）：待出貨的貨到付款／示範單＝取消鈕（照舊）；
 * 已付款的線上單＝沒有申請→「申請取消」、申請中→「撤回申請」，申請過且已被拒或撤回就沒有（每張訂單只能申請一次，D32）。
 * 申請資料讀不到（undefined）時照樣給「申請取消」，真的已經申請過的話由伺服器回錯誤（CANCEL_ALREADY_REQUESTED）。
 * 其餘（還沒付完款的由待付款區處理、已出貨以後、已取消、退款中、已退款）不顯示
 */
export function buyerCancelUi(status: OrderStatus, pay: OrderPayState, request: CancelRequestView | null | undefined): 'button' | 'request' | 'withdraw' | 'none' {
  if (status !== 'to_ship') return 'none';
  if (pay === 'cod' || pay === 'demo') return 'button';
  if (pay !== 'paid') return 'none';
  if (!request) return 'request';
  return request.status === 'pending' ? 'withdraw' : 'none';
}

/** 賣家端：已付款的線上單先不給取消（舊版；RF-A2 改用 sellerCancelUi，這個之後移除） */
export const sellerCanCancel = (payment: Order['payment']): boolean => payment !== 'ecpay_card';

/**
 * 賣家端的取消鈕（待出貨才會問）：貨到付款與示範單直接取消；已付款的線上單走 seller_cancel_paid_order（取消並退款），
 * 前端不得再對它送 UPDATE status='cancelled'（資料庫會擋，介面 8.9）；買家申請中時要先同意或拒絕，沒有取消鈕
 */
export function sellerCancelUi(payment: Order['payment'], request: CancelRequestView | null | undefined): 'direct' | 'refund' | 'none' {
  if (payment !== 'ecpay_card') return 'direct';
  return request?.status === 'pending' ? 'none' : 'refund';
}

/** 我的訂單網址的 ?tab=：只認 pending（待付款），其餘一律是「全部」（網址可被任何人亂改） */
export const ordersTabFromQuery = (raw: string | null): 'all' | 'pending' => (raw === 'pending' ? 'pending' : 'all');
