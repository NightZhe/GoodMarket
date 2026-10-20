import { describe, expect, it } from 'vitest';
import type { OrderStatus } from '../../types';
import type { CancelRequestView, OrderRefundRow, RefundView, ShopOrderRefundRow } from './types';
import {
  BUYER_CANCEL_REASONS, CANCEL_RESPOND_HOURS, SELLER_CANCEL_REASONS, buyerRefundView, dashboardCancelPrompt, ordersNavLabel, reasonText,
  sellerRefundView, sortPendingFirst, type Line, type StatusBlock,
} from './refundView';

// 預期文字逐字取自 .work/account-payment-methods/design-refund.md §4.2（買家 B1～B9）、§5.2（賣家 S1～S11）、§4.3 / §5.2 的 {誰}{原因}

const NOW = Date.parse('2026-10-21T00:00:00Z');
const ctx = { total: 1234, cardKnown: true, now: NOW, time: (iso: string) => `T(${iso.slice(5, 16)})`, day: (iso: string) => `D(${iso.slice(5, 10)})` };
// 卡別＋末四碼是另一個元件畫的（有 aria-hidden 的圓點），這裡用 ‹卡› 代表；信箱連結用 ‹信箱›
const flat = (l: Line): string => l.map(x => (typeof x === 'string' ? x : 'card' in x ? '‹卡›' : '‹信箱›')).join('');
const lines = (b: StatusBlock | null): string[] => (b ? b.lines.map(flat) : []);

const req = (status: CancelRequestView['status'], over: Partial<CancelRequestView> = {}): CancelRequestView => ({
  status, reason: 'no_longer_wanted', note: null, requested_at: '2026-10-20T06:00:00Z', respond_by: '2026-10-22T06:00:00Z',
  decided_at: status === 'pending' ? null : '2026-10-20T07:00:00Z', reject_reason: null, ...over,
});
const refund = (over: Partial<RefundView> = {}): RefundView => ({
  status: 'refunding', method: null, amount: 1234, started_at: '2026-10-20T08:00:00Z', refunded_at: null, needs_attention_since: null, ...over,
});
const row = (over: Partial<OrderRefundRow> = {}): OrderRefundRow => ({
  order_id: 'o1', cancel_request: null, cancelled_by: null, cancel_reason: null, cancel_note: null, refund: null, ...over,
});
const shopRow = (over: Partial<ShopOrderRefundRow> = {}): ShopOrderRefundRow => ({ ...row(), needs_manual: false, manual_hint: null, ...over });

const buyer = (status: OrderStatus, payState: Parameters<typeof buyerRefundView>[0]['payState'], r: OrderRefundRow | undefined, c = ctx) =>
  buyerRefundView({ status, payState, row: r }, c);

describe('原因文字（設計 4.3）', () => {
  it('買家與賣家各五／四個選項，順序與文字照設計 4.3', () => {
    expect(BUYER_CANCEL_REASONS.map(r => r.label)).toEqual(['不想買了', '想更換商品或規格', '重複下單', '賣家太久沒出貨', '其他']);
    expect(SELLER_CANCEL_REASONS.map(r => r.label)).toEqual(['缺貨或無法出貨', '買家要求取消', '價格或商品資訊有誤', '其他']);
    expect(BUYER_CANCEL_REASONS.map(r => r.code)).toEqual(['no_longer_wanted', 'change_item', 'duplicate_order', 'seller_too_slow', 'other']);
    expect(SELLER_CANCEL_REASONS.map(r => r.code)).toEqual(['out_of_stock', 'buyer_asked', 'listing_error', 'other']);
  });
  it('「其他」有說明寫「其他（說明）」，沒說明只寫「其他」；其他代碼不帶說明', () => {
    expect(reasonText('other', '太貴了')).toBe('其他（太貴了）');
    expect(reasonText('other', null)).toBe('其他');
    expect(reasonText('other', '  ')).toBe('其他');
    expect(reasonText('no_longer_wanted', '不該顯示')).toBe('不想買了');
    expect(reasonText('out_of_stock', null)).toBe('缺貨或無法出貨');
  });
  it('逾時小時數是常數 48（H-RF6 可能調）', () => { expect(CANCEL_RESPOND_HOURS).toBe(48); });
});

describe('買家 B1～B9', () => {
  it('B1 待出貨已付款沒有申請：沒有晶片、沒有區塊', () => {
    const v = buyer('to_ship', 'paid', undefined);
    expect(v.chip).toBeNull();
    expect(v.block).toBeNull();
  });
  it('B2 申請中（期限未到）', () => {
    const v = buyer('to_ship', 'paid', row({ cancel_request: req('pending') }));
    expect(v.chip).toBe('cancelRequested');
    expect(v.block?.tone).toBe('info');
    expect(v.block?.title).toBe('取消申請中，等賣家回應');
    expect(lines(v.block)).toEqual([
      '你在 T(10-20T06:00) 申請取消，原因：不想買了。',
      '賣家回應前不會出貨。賣家在 T(10-22T06:00) 前沒有回應，訂單會自動取消並退款。',
    ]);
  });
  it('B2 原因選「其他」帶說明', () => {
    const v = buyer('to_ship', 'paid', row({ cancel_request: req('pending', { reason: 'other', note: '想改買別款' }) }));
    expect(lines(v.block)[0]).toBe('你在 T(10-20T06:00) 申請取消，原因：其他（想改買別款）。');
  });
  it("B2′ 期限已到、排程還沒處理：第二行換成系統正在處理", () => {
    const v = buyer('to_ship', 'paid', row({ cancel_request: req('pending', { respond_by: '2026-10-20T23:59:00Z' }) }));
    expect(v.chip).toBe('cancelRequested');
    expect(lines(v.block)[1]).toBe('回應期限已到，系統正在處理，完成後這裡會更新。');
  });
  it('B3 被拒：灰色區塊、拒絕原因、不能再申請、聯絡信箱', () => {
    const v = buyer('to_ship', 'paid', row({ cancel_request: req('rejected', { reject_reason: '商品已打包' }) }));
    expect(v.chip).toBeNull();
    expect(v.block?.tone).toBe('neutral');
    expect(v.block?.title).toBe('賣家沒有同意取消');
    expect(lines(v.block)).toEqual(['原因：商品已打包。', '訂單照常出貨。每張訂單只能申請一次，這筆訂單不能再申請取消。', '如有疑問請聯絡我們：‹信箱›']);
  });
  it('B3 拒絕原因本身已以句號結尾時不重複加句號（使用者輸入的文字）', () => {
    const v = buyer('to_ship', 'paid', row({ cancel_request: req('rejected', { reject_reason: '商品已經打包，今天會寄出。' }) }));
    expect(lines(v.block)[0]).toBe('原因：商品已經打包，今天會寄出。');
    const s = seller('to_ship', shopRow({ cancel_request: req('rejected', { reject_reason: 'Already packed!' }) }));
    expect(lines(s.block)[0]).toBe('原因：Already packed!');
  });
  it('B4 已撤回（採用小u 補的文案）', () => {
    const v = buyer('to_ship', 'paid', row({ cancel_request: req('withdrawn') }));
    expect(v.block?.tone).toBe('neutral');
    expect(v.block?.title).toBe('你已撤回取消申請');
    expect(lines(v.block)).toEqual(['訂單照常出貨。每張訂單只能申請一次，這筆訂單不能再申請取消。', '如有疑問請聯絡我們：‹信箱›']);
  });
  it('B5 已取消＋退款處理中：晶片、金額、卡、誰（三種發起者）', () => {
    const base = { refund: refund(), cancel_reason: 'no_longer_wanted' as const };
    const buyerCancelled = buyer('cancelled', 'refunding', row({ ...base, cancelled_by: 'buyer', cancel_request: req('accepted') }));
    expect(buyerCancelled.chip).toBe('refunding');
    expect(buyerCancelled.block?.tone).toBe('info');
    expect(buyerCancelled.block?.title).toBe('退款處理中');
    expect(lines(buyerCancelled.block)).toEqual(['全額 $1,234 會退回 ‹卡›。完成後這裡會顯示退款方式。', '你申請取消，賣家已同意。原因：不想買了。']);
    const seller = buyer('cancelled', 'refunding', row({ refund: refund(), cancelled_by: 'seller', cancel_reason: 'out_of_stock' }));
    expect(lines(seller.block)[1]).toBe('賣家取消了這筆訂單。原因：缺貨或無法出貨。');
    const auto = buyer('cancelled', 'refunding', row({ ...base, cancelled_by: 'auto' }));
    expect(lines(auto.block)[1]).toBe('你申請取消，賣家在期限內沒有回應，系統已自動同意。原因：不想買了。');
  });
  it('B5 維運對齊的單沒有發起者（cancelled_by=null）：誰那一行不出現', () => {
    const v = buyer('cancelled', 'refunding', row({ refund: refund() }));
    expect(lines(v.block)).toEqual(['全額 $1,234 會退回 ‹卡›。完成後這裡會顯示退款方式。']);
  });
  it("B5′ 退款處理中超過 3 天（用 started_at）或被標記需要人工：多一行聯絡信箱，不出現失敗字樣（D29）", () => {
    const old = buyer('cancelled', 'refunding', row({ refund: refund({ started_at: '2026-10-17T23:59:00Z' }), cancelled_by: 'seller', cancel_reason: 'other' }));
    expect(lines(old.block)).toEqual([
      '全額 $1,234 會退回 ‹卡›。完成後這裡會顯示退款方式。', '賣家取消了這筆訂單。原因：其他。', '如有疑問請聯絡我們：‹信箱›',
    ]);
    const flagged = buyer('cancelled', 'refunding', row({ refund: refund({ needs_attention_since: '2026-10-20T20:00:00Z' }), cancelled_by: 'seller', cancel_reason: 'other' }));
    expect(lines(flagged.block).at(-1)).toBe('如有疑問請聯絡我們：‹信箱›');
    const almost = buyer('cancelled', 'refunding', row({ refund: refund({ started_at: '2026-10-18T00:01:00Z' }) }));
    expect(lines(almost.block)).toHaveLength(1);
    for (const r of [old, flagged]) expect(JSON.stringify(r)).not.toMatch(/失敗|異常|錯誤/);
  });
  it('B6 已退款：取消授權（關帳前）', () => {
    const v = buyer('cancelled', 'refunded', row({ refund: refund({ status: 'refunded', method: 'void', refunded_at: '2026-10-20T09:00:00Z' }), cancelled_by: 'buyer', cancel_reason: 'duplicate_order' }));
    expect(v.chip).toBe('refunded');
    expect(v.block?.tone).toBe('success');
    expect(v.block?.title).toBe('已退款');
    expect(lines(v.block)).toEqual([
      '已取消授權，這筆 $1,234 不會向你請款。',
      '若銀行 App 先出現一筆暫時的授權紀錄，會由發卡銀行自動消失，消失時間依發卡銀行而定。',
      '你申請取消，賣家已同意。原因：重複下單。',
    ]);
  });
  it('B7 已退款：退刷（關帳後），帶月/日，不寫到帳天數', () => {
    const v = buyer('cancelled', 'refunded', row({ refund: refund({ status: 'refunded', method: 'card_refund', refunded_at: '2026-10-22T09:00:00Z' }), cancelled_by: 'seller', cancel_reason: 'listing_error' }));
    expect(lines(v.block)).toEqual([
      '已退刷 $1,234 到 ‹卡›（D(10-22)）。',
      '入帳時間依發卡銀行作業，可能出現在本期或下一期帳單。',
      '賣家取消了這筆訂單。原因：價格或商品資訊有誤。',
    ]);
    expect(lines(v.block).join('')).not.toMatch(/\d+\s*(天|日內|個工作)/);
  });
  it("B7′ 維運人工完成（method='manual'）：只有金額與卡，誰有才寫", () => {
    const v = buyer('cancelled', 'refunded', row({ refund: refund({ status: 'refunded', method: 'manual', refunded_at: '2026-10-22T09:00:00Z' }) }));
    expect(v.chip).toBe('refunded');
    expect(lines(v.block)).toEqual(['$1,234 已退回你付款的 ‹卡›。入帳時間依發卡銀行作業。']);
    const withWho = buyer('cancelled', 'refunded', row({ refund: refund({ status: 'refunded', method: 'manual' }), cancelled_by: 'seller', cancel_reason: 'other', cancel_note: '缺貨' }));
    expect(lines(withWho.block)[1]).toBe('賣家取消了這筆訂單。原因：其他（缺貨）。');
  });
  it('B8 運送中／已完成但已退款（維運人工對齊）：留在原狀態，只多晶片與區塊', () => {
    for (const status of ['shipping', 'completed'] as const) {
      const v = buyer(status, 'refunded', row({ refund: refund({ status: 'refunded', method: 'manual', refunded_at: '2026-10-22T09:00:00Z' }) }));
      expect(v.chip).toBe('refunded');
      expect(v.block?.title).toBe('已退款');
      expect(lines(v.block)).toEqual(['這筆訂單的 $1,234 已退回你付款的 ‹卡›。入帳時間依發卡銀行作業。']);
    }
  });
  it('B8 退款細節讀不到、但付款面已是 refunded 的運送中單，仍顯示已退款', () => {
    const v = buyer('shipping', 'refunded', undefined);
    expect(v.chip).toBe('refunded');
    expect(lines(v.block)).toEqual(['這筆訂單的 $1,234 已退回你付款的 ‹卡›。入帳時間依發卡銀行作業。']);
  });
  it('B9 補洞：已取消的已付款單讀不到退款資料 → 退款處理中，沒有金額、卡別', () => {
    for (const ps of ['paid', 'refunding', 'refunded'] as const) {
      const v = buyer('cancelled', ps, undefined);
      expect(v.chip).toBeNull();
      expect(v.block?.tone).toBe('info');
      expect(v.block?.title).toBe('退款處理中');
      expect(lines(v.block)).toEqual(['完成後這裡會顯示退款方式。']);
    }
  });
  it('已取消但沒付過款（貨到付款、付款逾時、示範）：沒有任何退款字眼', () => {
    for (const ps of ['cod', 'demo', 'expired', 'unknown', 'pending'] as const) {
      const v = buyer('cancelled', ps, undefined);
      expect(v.chip).toBeNull();
      expect(v.block).toBeNull();
    }
  });
  it('沒有退款資料的一般訂單（開關關著、既有訂單）：任何狀態都沒有退款字眼', () => {
    for (const status of ['to_ship', 'shipping', 'completed'] as const) {
      for (const ps of ['cod', 'demo', 'unknown', 'paid'] as const) {
        const v = buyer(status, ps, undefined);
        expect(v).toEqual({ chip: null, block: null });
      }
    }
  });
  it('讀不到卡別末四碼：整段寫成「你付款的信用卡」', () => {
    const noCard = { ...ctx, cardKnown: false };
    const refunding = buyer('cancelled', 'refunding', row({ refund: refund() }), noCard);
    expect(lines(refunding.block)[0]).toBe('全額 $1,234 會退回你付款的信用卡。完成後這裡會顯示退款方式。');
    const card = buyer('cancelled', 'refunded', row({ refund: refund({ status: 'refunded', method: 'card_refund', refunded_at: '2026-10-22T09:00:00Z' }) }), noCard);
    expect(lines(card.block)[0]).toBe('已退刷 $1,234 到你付款的信用卡（D(10-22)）。');
    const manual = buyer('cancelled', 'refunded', row({ refund: refund({ status: 'refunded', method: 'manual' }) }), noCard);
    expect(lines(manual.block)[0]).toBe('$1,234 已退回你付款的信用卡。入帳時間依發卡銀行作業。');
  });
});

const seller = (status: OrderStatus, r: ShopOrderRefundRow | undefined, payment: 'ecpay_card' | 'cod' = 'ecpay_card') =>
  sellerRefundView({ status, payment, row: r }, { total: 1234, now: NOW, time: ctx.time });

describe('賣家 S1～S11', () => {
  it('S1 待出貨、沒有申請：沒有徽章、沒有區塊，撥款區塊照常', () => {
    const v = seller('to_ship', undefined);
    expect(v).toMatchObject({ badge: null, block: null, refundStatus: null, hidePayout: false });
  });
  it('S2 買家申請取消：琥珀區塊', () => {
    const v = seller('to_ship', shopRow({ cancel_request: req('pending', { reason: 'seller_too_slow' }) }));
    expect(v.badge).toBe('requested');
    expect(v.block?.tone).toBe('warning');
    expect(v.block?.title).toBe('買家申請取消這筆訂單');
    expect(lines(v.block)).toEqual(['原因：賣家太久沒出貨。申請時間 T(10-20T06:00)。', '請在 T(10-22T06:00) 前回應。逾時，系統會自動同意取消並退款。']);
    expect(v.hidePayout).toBe(false);
  });
  it("S2′ 期限已到、排程還沒處理", () => {
    const v = seller('to_ship', shopRow({ cancel_request: req('pending', { respond_by: '2026-10-20T23:00:00Z' }) }));
    expect(lines(v.block)[1]).toBe('回應期限已到，系統正在處理。');
  });
  it('S3 自己拒絕過（灰色）', () => {
    const v = seller('to_ship', shopRow({ cancel_request: req('rejected', { reject_reason: '今天會寄出' }) }));
    expect(v.badge).toBeNull();
    expect(v.block?.tone).toBe('neutral');
    expect(v.block?.title).toBe('你已拒絕買家的取消申請');
    expect(lines(v.block)).toEqual(['原因：今天會寄出。', '買家不能再申請取消這筆訂單。']);
  });
  it('S4 買家撤回（灰色）', () => {
    const v = seller('to_ship', shopRow({ cancel_request: req('withdrawn') }));
    expect(v.block?.title).toBe('買家已撤回取消申請');
    expect(lines(v.block)).toEqual(['訂單照常出貨。']);
  });
  it('S5 退款處理中：不顯示撥款區塊；三種發起者的誰', () => {
    const mk = (by: 'buyer' | 'seller' | 'auto', reason: 'no_longer_wanted' | 'out_of_stock') =>
      seller('cancelled', shopRow({ refund: refund(), cancelled_by: by, cancel_reason: reason }));
    const v = mk('seller', 'out_of_stock');
    expect(v.badge).toBe('refunding');
    expect(v.refundStatus).toBe('refunding');
    expect(v.hidePayout).toBe(true);
    expect(v.block?.tone).toBe('info');
    expect(v.block?.title).toBe('退款處理中');
    expect(lines(v.block)).toEqual(['$1,234 會退回買家的信用卡，不需要你操作。', '你取消了這筆訂單。原因：缺貨或無法出貨。']);
    expect(lines(mk('buyer', 'no_longer_wanted').block)[1]).toBe('買家申請取消，你已同意。原因：不想買了。');
    expect(lines(mk('auto', 'no_longer_wanted').block)[1]).toBe('買家申請取消，你在期限內沒有回應，系統已自動同意。原因：不想買了。');
  });
  it('S6 已退款：取消授權', () => {
    const v = seller('cancelled', shopRow({ refund: refund({ status: 'refunded', method: 'void', refunded_at: '2026-10-20T09:00:00Z' }), cancelled_by: 'seller', cancel_reason: 'buyer_asked' }));
    expect(v.badge).toBe('refunded');
    expect(v.hidePayout).toBe(true);
    expect(v.block?.tone).toBe('success');
    expect(lines(v.block)).toEqual([
      '$1,234 已退款給買家（取消授權，T(10-20T09:00)）。', '取消授權：這筆款項不會向買家請款。', '你取消了這筆訂單。原因：買家要求取消。',
    ]);
  });
  it('S7 已退款：退刷', () => {
    const v = seller('cancelled', shopRow({ refund: refund({ status: 'refunded', method: 'card_refund', refunded_at: '2026-10-22T09:00:00Z' }), cancelled_by: 'buyer', cancel_reason: 'change_item' }));
    expect(lines(v.block)).toEqual([
      '$1,234 已退款給買家（退刷，T(10-22T09:00)）。', '退刷：款項已請款，已退回買家的信用卡。', '買家申請取消，你已同意。原因：想更換商品或規格。',
    ]);
  });
  it("S7′ 維運人工完成：沒有方式說明，誰有才寫", () => {
    const v = seller('cancelled', shopRow({ refund: refund({ status: 'refunded', method: 'manual', refunded_at: '2026-10-22T09:00:00Z' }) }));
    expect(lines(v.block)).toEqual(['$1,234 已退款給買家（T(10-22T09:00)）。']);
  });
  it('S8 運送中／已完成但已退款：原狀態不變，仍不顯示撥款', () => {
    const v = seller('completed', shopRow({ refund: refund({ status: 'refunded', method: 'manual', refunded_at: '2026-10-22T09:00:00Z' }) }));
    expect(v.badge).toBe('refunded');
    expect(v.hidePayout).toBe(true);
    expect(lines(v.block)).toEqual(['這筆訂單的 $1,234 已退款給買家（T(10-22T09:00)）。']);
  });
  it('S9 需要人工（一般）；餘額不足（S10）在 H-RF3 確認前一律也用 S9 的字', () => {
    const base = { refund: refund({ needs_attention_since: '2026-10-22T09:00:00Z' }), needs_manual: true, cancelled_by: 'seller' as const, cancel_reason: 'other' as const };
    for (const hint of [null, 'other', 'balance'] as const) {
      const v = seller('cancelled', shopRow({ ...base, manual_hint: hint }));
      expect(v.badge).toBe('refunding');
      expect(v.block?.tone).toBe('info');
      expect(v.block?.title).toBe('退款還沒完成，好物集正在處理。');
      expect(lines(v.block)).toEqual(['$1,234 會退回買家的信用卡，不需要你操作。', '你取消了這筆訂單。原因：其他。']);
      expect(JSON.stringify(v)).not.toMatch(/餘額|儲值|失敗/);
    }
  });
  it('S11 補洞：已取消的線上單讀不到退款資料', () => {
    const v = seller('cancelled', undefined);
    expect(v.badge).toBeNull();
    expect(v.hidePayout).toBe(true);
    expect(v.block?.tone).toBe('info');
    expect(v.block?.title).toBe('退款處理中');
    expect(lines(v.block)).toEqual(['退款資料暫時讀不到，稍後重新整理。']);
  });
  it('貨到付款的已取消單、沒有退款資料的一般單：沒有退款字眼，撥款區塊維持現況', () => {
    expect(seller('cancelled', undefined, 'cod')).toMatchObject({ badge: null, block: null, hidePayout: false });
    expect(seller('shipping', undefined)).toMatchObject({ badge: null, block: null, hidePayout: false });
    expect(seller('completed', undefined)).toMatchObject({ badge: null, block: null, hidePayout: false });
  });
});

describe('排序與待辦文案', () => {
  it('申請中的訂單排最前，其餘維持原順序（穩定）', () => {
    const o = (id: string) => ({ id });
    const pending = new Set(['c', 'e']);
    expect(sortPendingFirst([o('a'), o('b'), o('c'), o('d'), o('e')], x => pending.has(x.id)).map(x => x.id)).toEqual(['c', 'e', 'a', 'b', 'd']);
    expect(sortPendingFirst([o('a'), o('b')], () => false).map(x => x.id)).toEqual(['a', 'b']);
  });
  it('底欄「訂單管理」的 aria-label：有申請才指定；待出貨為 0 時省略前半（設計 6.2）', () => {
    expect(ordersNavLabel(3, 2)).toBe('訂單管理，待出貨 3 筆，取消申請 2 筆');
    expect(ordersNavLabel(0, 2)).toBe('訂單管理，取消申請 2 筆');
    expect(ordersNavLabel(3, 0)).toBeUndefined();
    expect(ordersNavLabel(0, 0)).toBeUndefined();
  });
  it('賣場總覽提示列文案', () => {
    expect(dashboardCancelPrompt(2, '2026-10-22T06:00:00Z', ctx.time)).toEqual({
      title: '取消申請 2', body: '買家在等你同意或拒絕。最早的回應期限是 T(10-22T06:00)，逾時會自動同意並退款。',
    });
    expect(dashboardCancelPrompt(1, null, ctx.time).body).toBe('買家在等你同意或拒絕。');
  });
});
