import { describe, expect, it } from 'vitest';
import type { Order } from '../../types';
import type { CancelRequestView, OrderPaymentRow } from './types';
import { BUYER_PAY_LABEL, SELLER_PAY_LABEL, orderPayLine, buyerCancelUi, orderPayLineIfOn, orderPayState, hasBatchSiblings, pendingBatch, sellerCancelUi, sellerPayLabel } from './orderView';

const req = (status: CancelRequestView['status']): CancelRequestView => ({
  status, reason: 'no_longer_wanted', note: null, requested_at: '2026-10-20T06:00:00Z', respond_by: '2026-10-22T06:00:00Z', decided_at: status === 'pending' ? null : '2026-10-20T07:00:00Z', reject_reason: null,
});

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
  it('退款：get_order_payments 多出 refunding、refunded 兩個值，要接得到（不能落到 unknown）', () => {
    expect(orderPayState('ecpay_card', row({ payment_status: 'refunding' }))).toBe('refunding');
    expect(orderPayState('ecpay_card', row({ payment_status: 'refunded' }))).toBe('refunded');
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
  it('退款中、已退款：結尾字隨狀態變（設計 4.1）', () => {
    expect(orderPayLine('ecpay_card', row({ payment_status: 'refunding' }))).toBe('信用卡 Visa •••• 4242・退款處理中');
    expect(orderPayLine('ecpay_card', row({ payment_status: 'refunded' }))).toBe('信用卡 Visa •••• 4242・已退款');
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

describe('hasBatchSiblings：同一次付款是否還有其他訂單（申請取消對話框的「其他訂單不受影響」那句）', () => {
  it('同付款群組還有別張訂單（不論狀態）就是 true', () => {
    const pays = [row({ order_id: 'a', group_id: 'g1' }), row({ order_id: 'b', group_id: 'g1', payment_status: 'refunded' }), row({ order_id: 'c', group_id: 'g2' })];
    expect(hasBatchSiblings('a', pays)).toBe(true);
    expect(hasBatchSiblings('c', pays)).toBe(false);
  });
  it('沒有群組編號、或讀不到付款資訊：false', () => {
    expect(hasBatchSiblings('a', [row({ order_id: 'a', group_id: null })])).toBe(false);
    expect(hasBatchSiblings('a', [])).toBe(false);
  });
});

describe('開關關著時，付款相關字樣不出現（與開關打開前的畫面逐字相同）', () => {
  it('買家訂單 footer 的付款方式一行：開關關著不顯示', () => {
    expect(orderPayLineIfOn(false, 'cod', undefined)).toBeNull();
    expect(orderPayLineIfOn(false, 'card', undefined)).toBeNull();
    expect(orderPayLineIfOn(true, 'cod', undefined)).toBe('貨到付款');
    expect(orderPayLineIfOn(true, 'ecpay_card', row())).toBe('信用卡 Visa •••• 4242・已付款');
  });
  it('賣家訂單 footer 的付款標籤：關著時示範單維持原本的「信用卡」「ATM 轉帳」，沒有「（示範）」', () => {
    expect(sellerPayLabel('cod', false)).toBe('貨到付款');
    expect(sellerPayLabel('card', false)).toBe('信用卡');
    expect(sellerPayLabel('transfer', false)).toBe('ATM 轉帳');
    expect(sellerPayLabel('card', true)).toBe('信用卡（示範）');
    expect(sellerPayLabel('transfer', true)).toBe('ATM 轉帳（示範）');
  });
  it('已經存在的線上付款單不受開關影響：賣家永遠看得到「信用卡・已付款」', () => {
    expect(sellerPayLabel('ecpay_card', false)).toBe('信用卡・已付款');
    expect(sellerPayLabel('ecpay_card', true)).toBe('信用卡・已付款');
  });
});

describe('買家取消區：貨到付款照舊；已付款的線上單改成「申請取消／撤回申請」（設計 8 第 2 點）', () => {
  it('待出貨的貨到付款／示範單照舊有取消鈕', () => {
    expect(buyerCancelUi('to_ship', 'cod', undefined)).toBe('button');
    expect(buyerCancelUi('to_ship', 'demo', undefined)).toBe('button');
  });
  it('已付款、待出貨、沒有申請：申請取消；申請資料讀不到（undefined）也是，被擋時由伺服器回錯誤', () => {
    expect(buyerCancelUi('to_ship', 'paid', null)).toBe('request');
    expect(buyerCancelUi('to_ship', 'paid', undefined)).toBe('request');
  });
  it('申請中：撤回申請（即使期限已過、排程還沒處理）', () => {
    expect(buyerCancelUi('to_ship', 'paid', req('pending'))).toBe('withdraw');
  });
  it('申請過且已被拒或已撤回：每張訂單只能申請一次（D32），沒有按鈕', () => {
    expect(buyerCancelUi('to_ship', 'paid', req('rejected'))).toBe('none');
    expect(buyerCancelUi('to_ship', 'paid', req('withdrawn'))).toBe('none');
  });
  it('還沒付完款的由待付款區處理，不給取消鈕', () => {
    expect(buyerCancelUi('to_ship', 'pending', undefined)).toBe('none');
    expect(buyerCancelUi('to_ship', 'confirming', undefined)).toBe('none');
    expect(buyerCancelUi('to_ship', 'unknown', undefined)).toBe('none');
  });
  it('已出貨以後、已取消、退款中、已退款：沒有取消入口（AC-RF8）', () => {
    expect(buyerCancelUi('shipping', 'paid', undefined)).toBe('none');
    expect(buyerCancelUi('completed', 'paid', undefined)).toBe('none');
    expect(buyerCancelUi('cancelled', 'cod', undefined)).toBe('none');
    expect(buyerCancelUi('cancelled', 'refunding', undefined)).toBe('none');
    expect(buyerCancelUi('cancelled', 'refunded', undefined)).toBe('none');
    expect(buyerCancelUi('completed', 'refunded', undefined)).toBe('none');
  });
});

describe('賣家取消區：已付款線上單走「取消並退款」，前端不再對它送 UPDATE status=cancelled（介面 8.9）', () => {
  it('貨到付款與示範單照舊直接取消', () => {
    expect(sellerCancelUi('cod', null)).toBe('direct');
    expect(sellerCancelUi('card', null)).toBe('direct');
    expect(sellerCancelUi('transfer', undefined)).toBe('direct');
  });
  it('已付款線上單：沒有申請（或申請已結束）→ 取消並退款；申請中 → 沒有（要先同意或拒絕）', () => {
    expect(sellerCancelUi('ecpay_card', null)).toBe('refund');
    expect(sellerCancelUi('ecpay_card', undefined)).toBe('refund');
    expect(sellerCancelUi('ecpay_card', req('rejected'))).toBe('refund');
    expect(sellerCancelUi('ecpay_card', req('withdrawn'))).toBe('refund');
    expect(sellerCancelUi('ecpay_card', req('pending'))).toBe('none');
  });
});

describe('賣家端付款標籤隨退款狀態變（設計 5.1）', () => {
  it('退款處理中、已退款只換結尾；沒有退款資料時與上線前逐字相同', () => {
    expect(sellerPayLabel('ecpay_card', true, 'refunding')).toBe('信用卡・退款處理中');
    expect(sellerPayLabel('ecpay_card', false, 'refunded')).toBe('信用卡・已退款');
    expect(sellerPayLabel('ecpay_card', true, null)).toBe('信用卡・已付款');
    expect(sellerPayLabel('cod', true, 'refunded')).toBe('貨到付款');
  });
});
