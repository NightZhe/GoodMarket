import type { Order } from '../types';

// 平台費率（示範值，要調整改這裡就好）
// 參考市場行情：成交手續費 5%、金流與系統處理費 2%。
export const FEE_RATES = {
  commission: 0.05,  // 成交手續費：對商品價格收取
  payment: 0.02,     // 金流與系統處理費：對訂單金額（含運費）收取
  service: 0,        // 其他服務費：目前不收，之後要加再改
} as const;

export interface Payout {
  itemTotal: number;      // 商品價格
  buyerShipping: number;  // 買家支付運費
  orderTotal: number;     // 訂單金額
  commission: number;     // 成交手續費（負值）
  payment: number;        // 金流與系統處理費（負值）
  service: number;        // 其他服務費（負值）
  feeTotal: number;       // 手續費合計（負值）
  net: number;            // 預估訂單進帳
}

/** 賣家這筆訂單實際能拿到多少 */
export const payoutOf = (order: Order): Payout => {
  const itemTotal = order.lines.reduce((s, l) => s + l.price * l.qty, 0);
  const buyerShipping = order.shippingFee;
  const orderTotal = itemTotal + buyerShipping;

  const commission = -Math.round(itemTotal * FEE_RATES.commission);
  const payment = -Math.round(orderTotal * FEE_RATES.payment);
  const service = -Math.round(itemTotal * FEE_RATES.service);
  const feeTotal = commission + payment + service;

  return { itemTotal, buyerShipping, orderTotal, commission, payment, service, feeTotal, net: orderTotal + feeTotal };
};
