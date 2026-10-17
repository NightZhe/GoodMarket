import type { OrderRow } from '../supabase';
import type { Order } from '../../types';

/** 資料庫的訂單列 → App 內部的 Order。買家端的列沒有收件欄位，賣家端有 */
export const toOrder = (r: OrderRow | Omit<OrderRow, 'buyer_name' | 'buyer_phone' | 'buyer_address'>): Order => {
  const b = r as OrderRow;
  return {
    id: r.id, orderNo: r.order_no, shopId: r.shop_id, lines: r.lines,
    shippingFee: r.shipping_fee, total: r.total,
    status: r.status, payment: r.payment, createdAt: r.created_at,
    carrier: r.carrier, trackingNo: r.tracking_no,
    events: (r.events ?? []) as Order['events'],
    buyer: { name: b.buyer_name ?? '', phone: b.buyer_phone ?? '', address: b.buyer_address ?? '' },
  };
};
