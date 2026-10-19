import type { Order } from '../../types';
import { brandLabel } from './cards';
import type { OrderPaymentRow } from './types';

// 訂單上的付款資訊。歷史的 'card'（示範時期）永遠不是已付款（R-B12）；賣家只會讀到已付款的線上單（待付款被資料庫過濾）。

export const BUYER_PAY_LABEL: Record<Order['payment'], string> = {
  cod: '貨到付款', card: '信用卡（示範）', transfer: 'ATM 轉帳（示範）', ecpay_card: '信用卡',
};

export const SELLER_PAY_LABEL: Record<Order['payment'], string> = {
  cod: '貨到付款', card: '信用卡（示範）', transfer: 'ATM 轉帳（示範）', ecpay_card: '信用卡・已付款',
};

export type OrderPayState = 'cod' | 'demo' | 'paid' | 'pending' | 'confirming' | 'expired' | 'unknown';

/** 買家訂單的付款狀態。線上付款以 get_order_payments 為準；還沒讀到付款資訊時是 unknown（不能顯示成已付款） */
export function orderPayState(payment: Order['payment'], pay: OrderPaymentRow | undefined): OrderPayState {
  if (payment === 'cod') return 'cod';
  if (payment !== 'ecpay_card') return 'demo';
  if (!pay) return 'unknown';
  switch (pay.payment_status) {
    case 'paid': return 'paid';
    case 'pending': return 'pending';
    case 'confirming': return 'confirming';
    case 'expired':
    case 'failed': return 'expired';
    default: return 'unknown';
  }
}

/** 訂單卡 footer 的付款方式一行字（設計 10.1） */
export function orderPayLine(payment: Order['payment'], pay: OrderPaymentRow | undefined): string {
  if (orderPayState(payment, pay) === 'paid' && pay) {
    const brand = pay.card_brand ? `${brandLabel(pay.card_brand)} ` : '';
    return `信用卡 ${brand}•••• ${pay.card4 ?? ''}・已付款`;
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

/** 買家訂單 footer 的付款方式一行：開關關著時整行不出現（畫面與沒有線上付款功能時逐字相同） */
export const orderPayLineIfOn = (onlineOn: boolean, payment: Order['payment'], pay: OrderPaymentRow | undefined): string | null =>
  onlineOn ? orderPayLine(payment, pay) : null;

/** 開關關著時賣家看到的標籤：維持上線前的字（沒有「（示範）」）。已存在的線上付款單一律「信用卡・已付款」，不受開關影響 */
const SELLER_LEGACY_LABEL: Record<Order['payment'], string> = { cod: '貨到付款', card: '信用卡', transfer: 'ATM 轉帳', ecpay_card: SELLER_PAY_LABEL.ecpay_card };
export const sellerPayLabel = (payment: Order['payment'], onlineOn: boolean): string =>
  (onlineOn ? SELLER_PAY_LABEL : SELLER_LEGACY_LABEL)[payment];
