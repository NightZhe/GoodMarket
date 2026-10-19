import { describe, expect, it } from 'vitest';
import type { Order } from '../../types';
import type { OrderPaymentRow } from './types';
import { BUYER_PAY_LABEL, SELLER_PAY_LABEL, orderPayLine, orderPayState, pendingBatch } from './orderView';

const row = (over: Partial<OrderPaymentRow> = {}): OrderPaymentRow => ({
  order_id: 'o1', group_id: 'g1', payment_status: 'paid', pay_expires_at: null, paid_at: '2026-10-19T08:00:00Z', card_brand: 'visa', card4: '4242', last_fail: null, ...over,
});

describe('付款方式的標籤對照表完整性（Order.payment 的每個值都有字）', () => {
  // 型別強迫：Order['payment'] 多一個值，這裡編譯不過
  const ALL: Record<Order['payment'], 1> = { cod: 1, card: 1, transfer: 1, ecpay_card: 1 };
  it('買家端與賣家端都涵蓋 ecpay_card，且沒有 undefined', () => {
    for (const k of Object.keys(ALL) as Order['payment'][]) {
      expect(BUYER_PAY_LABEL[k], k).toBeTruthy();
      expect(SELLER_PAY_LABEL[k], k).toBeTruthy();
    }
  });
  it('歷史示範單永遠不寫已付款（R-B12、AC-B20）', () => {
    expect(BUYER_PAY_LABEL.card).toBe('信用卡（示範）');
    expect(SELLER_PAY_LABEL.card).not.toMatch(/已付款/);
    expect(BUYER_PAY_LABEL.card).not.toMatch(/已付款/);
  });
  it('賣家看到的線上付款單一定是已付款（待付款賣家看不到）', () => {
    expect(SELLER_PAY_LABEL.ecpay_card).toBe('信用卡・已付款');
    expect(SELLER_PAY_LABEL.cod).toBe('貨到付款');
  });
});

describe('orderPayState', () => {
  it('貨到付款、示範單沒有付款狀態可言', () => {
    expect(orderPayState('cod', undefined)).toBe('cod');
    expect(orderPayState('card', undefined)).toBe('demo');
    expect(orderPayState('transfer', undefined)).toBe('demo');
  });
  it('線上付款：以 get_order_payments 的 payment_status 為準', () => {
    expect(orderPayState('ecpay_card', row({ payment_status: 'pending' }))).toBe('pending');
    expect(orderPayState('ecpay_card', row({ payment_status: 'confirming' }))).toBe('confirming');
    expect(orderPayState('ecpay_card', row({ payment_status: 'paid' }))).toBe('paid');
    expect(orderPayState('ecpay_card', row({ payment_status: 'expired' }))).toBe('expired');
    expect(orderPayState('ecpay_card', row({ payment_status: 'failed' }))).toBe('expired');
  });
  it('線上付款但還沒讀到付款資訊：未知，不能顯示成已付款', () => {
    expect(orderPayState('ecpay_card', undefined)).toBe('unknown');
  });
});

describe('orderPayLine：訂單卡 footer 的付款方式一行字', () => {
  it('已付款寫卡別、末四碼', () => {
    expect(orderPayLine('ecpay_card', row())).toBe('信用卡 Visa •••• 4242・已付款');
  });
  it('其他線上狀態只寫「信用卡」，不寫已付款', () => {
    expect(orderPayLine('ecpay_card', row({ payment_status: 'pending' }))).toBe('信用卡');
    expect(orderPayLine('ecpay_card', undefined)).toBe('信用卡');
  });
  it('貨到付款、示範', () => {
    expect(orderPayLine('cod', undefined)).toBe('貨到付款');
    expect(orderPayLine('card', undefined)).toBe('信用卡（示範）');
  });
});

describe('pendingBatch：同一批待付款的訂單', () => {
  const o = (id: string) => ({ id });
  it('回傳同一個付款群組、且仍待付款的所有訂單，含自己', () => {
    const pays = [row({ order_id: 'a', group_id: 'g1', payment_status: 'pending' }), row({ order_id: 'b', group_id: 'g1', payment_status: 'pending' }), row({ order_id: 'c', group_id: 'g2', payment_status: 'pending' })];
    expect(pendingBatch('a', pays, [o('a'), o('b'), o('c')]).map(x => x.id)).toEqual(['a', 'b']);
  });
  it('沒有群組編號（舊資料）：只有自己', () => {
    const pays = [row({ order_id: 'a', group_id: null, payment_status: 'pending' })];
    expect(pendingBatch('a', pays, [o('a')]).map(x => x.id)).toEqual(['a']);
  });
});
