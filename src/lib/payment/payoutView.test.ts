import { describe, expect, it } from 'vitest';
import type { OrderStatus } from '../../types';
import type { SellerOrderPayoutRow } from './types';
import { PAYOUT_IDS_LIMIT } from './types';
import { chunkIds, payoutView, spokenDate, taipeiToday, updatedText } from './payoutView';

// 預期文字逐字取自 .work/account-payment-methods/spec-payout-reconcile.md §8.1（標籤與說明）、§8.3（給讀屏的完整日期）；
// 金額用站上既有的 money()（「$300」，不是規格示意裡的 NT$）

const TODAY = '2026-10-21';
const UPDATED = '2026-10-20T07:12:00Z'; // 台灣 15:12

const row = (over: Partial<SellerOrderPayoutRow> = {}): SellerOrderPayoutRow => ({
  order_id: 'o1', payout_status: 'captured', expected_payout_date: null, paid_out_date: null, payout_amount: null, fee_amount: null,
  clawback_amount: null, clawback_date: null, data_updated_at: UPDATED, has_ledger_rows: false, ...over,
});
const view = (r: SellerOrderPayoutRow | undefined, status: OrderStatus = 'to_ship', hidePayout = false, today = TODAY) =>
  payoutView({ orderStatus: status, hidePayout, row: r }, { today });

const UPDATING_TEXT = '綠界科技的對帳資料還沒送來。資料送來後這裡會更新，不影響出貨。預計撥款日與實際入帳時間以綠界科技為準。';

describe('payoutView：五種狀態', () => {
  it('captured：已請款，不寫任何日期，最後一行是資料更新時間', () => {
    expect(view(row())).toEqual({
      status: 'captured', tone: 'info', label: '已請款', labelSr: '已請款',
      description: '買家付款成功，好物集已向綠界科技請款。預計撥款日由綠界科技提供，目前還沒有資料。',
      amountLine: null, updatedLine: '資料更新於 2026/10/20 15:12',
    });
  });

  it('captured：就算 RPC 帶了金額也不顯示（D42＝C 只在預計撥款與已撥款顯示）', () => {
    expect(view(row({ payout_amount: 1180 }))?.amountLine).toBeNull();
  });

  it('scheduled：標籤帶月/日，讀屏念完整日期，顯示撥款金額', () => {
    expect(view(row({ payout_status: 'scheduled', expected_payout_date: '2026-10-28', payout_amount: 1234, has_ledger_rows: true }))).toEqual({
      status: 'scheduled', tone: 'info', label: '預計 10/28 撥款', labelSr: '預計 10 月 28 日撥款',
      description: '預計撥入你的綠界科技帳戶，實際以綠界科技為準。',
      amountLine: '撥款金額 $1,234', updatedLine: '資料更新於 2026/10/20 15:12',
    });
  });

  it('paid_out：已撥款日期、金額、說明', () => {
    expect(view(row({ payout_status: 'paid_out', paid_out_date: '2026-10-26', payout_amount: 980, has_ledger_rows: true }), 'completed', false, '2026-10-27')).toEqual({
      status: 'paid_out', tone: 'success', label: '已撥款 10/26', labelSr: '已撥款，10 月 26 日',
      description: '已撥入你的綠界科技帳戶。提領到銀行的時間以綠界科技為準。',
      amountLine: '撥款金額 $980', updatedLine: '資料更新於 2026/10/20 15:12',
    });
  });

  it('scheduled／paid_out 沒有金額時不顯示金額行（不猜）', () => {
    expect(view(row({ payout_status: 'scheduled', expected_payout_date: '2026-10-28' }))?.amountLine).toBeNull();
    expect(view(row({ payout_status: 'paid_out', paid_out_date: '2026-10-26' }))?.amountLine).toBeNull();
  });

  it('updating：現況文案逐字不變，沒有「資料更新於」', () => {
    expect(view(row({ payout_status: 'updating', data_updated_at: null }))).toEqual({
      status: 'updating', tone: 'neutral', label: '撥款資料更新中', labelSr: '撥款資料更新中',
      description: UPDATING_TEXT, amountLine: null, updatedLine: null,
    });
  });
});

describe('payoutView：D44＝A 沒有撥款日就永遠不出現日期（AC-R25）', () => {
  it('captured、updating 就算資料帶了日期欄位，畫面文字也沒有日期', () => {
    const stray = { expected_payout_date: '2026-10-28', paid_out_date: '2026-10-26' };
    for (const status of ['captured', 'updating'] as const) {
      const v = view(row({ payout_status: status, ...stray }));
      expect(`${v?.label}${v?.labelSr}${v?.description}`).not.toMatch(/\d+\s*[/月]\s*\d+/);
    }
  });
});

describe('payoutView：clawed_back', () => {
  const claw = (over: Partial<SellerOrderPayoutRow> = {}) =>
    row({ payout_status: 'clawed_back', clawback_amount: 300, clawback_date: '2026-11-02', has_ledger_rows: true, ...over });

  it('扣回日還沒到：會在 11/02 從你的撥款扣除', () => {
    expect(view(claw(), 'cancelled', true)).toMatchObject({
      status: 'clawed_back', tone: 'warning', label: '已退款扣回', labelSr: '已退款扣回',
      description: '買家退款 $300，綠界科技會在 11/02 從你的撥款扣除。', amountLine: null, updatedLine: '資料更新於 2026/10/20 15:12',
    });
  });

  it('扣回日當天算已過', () => {
    expect(view(claw(), 'cancelled', true, '2026-11-02')?.description).toBe('買家退款 $300，已在 11/02 從你的撥款扣除。');
  });

  it('扣回日已過：已在 11/02 從你的撥款扣除', () => {
    expect(view(claw(), 'cancelled', true, '2026-11-05')?.description).toBe('買家退款 $300，已在 11/02 從你的撥款扣除。');
  });

  it('扣回日是 null（綠界還沒排撥款日）：小p 定稿句，不寫日期', () => {
    expect(view(claw({ clawback_date: null }), 'cancelled', true)?.description).toBe('買家退款 $300，綠界科技會在撥款日從你的撥款扣除，日期確定後會顯示在這裡。');
  });

  it('扣回金額是 null：不寫金額', () => {
    expect(view(claw({ clawback_amount: null }), 'cancelled', true)?.description).toBe('買家已退款，綠界科技會在 11/02 從你的撥款扣除。');
    expect(view(claw({ clawback_amount: null, clawback_date: null }), 'cancelled', true)?.description).toBe('買家已退款，綠界科技會在撥款日從你的撥款扣除，日期確定後會顯示在這裡。');
  });

  it('跨年的日期加年份', () => {
    expect(view(claw({ clawback_date: '2027-01-05' }), 'cancelled', true)?.description).toBe('買家退款 $300，綠界科技會在 2027/01/05 從你的撥款扣除。');
  });
});

describe('payoutView：讀不到、不顯示', () => {
  it('讀取失敗或回應裡沒有這張單：顯示 updating（不顯示錯誤、不猜）', () => {
    expect(view(undefined)).toMatchObject({ status: 'updating', label: '撥款資料更新中', description: UPDATING_TEXT, updatedLine: null });
  });

  it('已取消而且沒有對帳列：不顯示區塊', () => {
    expect(view(row({ has_ledger_rows: false }), 'cancelled')).toBeNull();
    expect(view(row({ payout_status: 'updating', data_updated_at: null }), 'cancelled')).toBeNull();
  });

  it('已取消但讀不到撥款資料：不顯示（不能確認有沒有對帳列）', () => {
    expect(view(undefined, 'cancelled')).toBeNull();
  });

  it('已取消而且有對帳列：照狀態顯示', () => {
    expect(view(row({ has_ledger_rows: true }), 'cancelled')).toMatchObject({ status: 'captured' });
  });

  it('退款單（退款處理中、已退款）：只有已退款扣回才顯示，不把退款單顯示成會撥款', () => {
    expect(view(row({ has_ledger_rows: true }), 'cancelled', true)).toBeNull();
    expect(view(row({ payout_status: 'paid_out', paid_out_date: '2026-10-20', has_ledger_rows: true }), 'to_ship', true)).toBeNull();
    expect(view(row({ payout_status: 'scheduled', expected_payout_date: '2026-10-28', has_ledger_rows: true }), 'shipping', true)).toBeNull();
    expect(view(undefined, 'cancelled', true)).toBeNull();
    expect(view(row({ payout_status: 'clawed_back', clawback_amount: 100, clawback_date: '2026-10-30', has_ledger_rows: true }), 'completed', true)).toMatchObject({ status: 'clawed_back' });
  });
});

describe('日期與時間（一律台灣時間）', () => {
  it('taipeiToday：UTC 16:00 之後已經是台灣的隔天', () => {
    expect(taipeiToday(Date.parse('2026-10-20T15:59:00Z'))).toBe('2026-10-20');
    expect(taipeiToday(Date.parse('2026-10-20T16:00:00Z'))).toBe('2026-10-21');
  });

  it('updatedText：台灣時間，24 小時制，午夜不是 24:xx', () => {
    expect(updatedText('2026-10-20T07:12:00Z')).toBe('2026/10/20 15:12');
    expect(updatedText('2026-10-20T16:05:00Z')).toBe('2026/10/21 00:05');
  });

  it('spokenDate：同年「10 月 28 日」，跨年加年', () => {
    expect(spokenDate('2026-10-28', TODAY)).toBe('10 月 28 日');
    expect(spokenDate('2027-01-05', TODAY)).toBe('2027 年 1 月 5 日');
  });
});

describe('chunkIds：一次請求取整頁（AC-R24），超過上限才分批', () => {
  it('50 張一批', () => {
    const ids = Array.from({ length: 50 }, (_, i) => `o${i}`);
    expect(chunkIds(ids)).toEqual([ids]);
  });
  it('剛好 200 一批、201 兩批', () => {
    const ids = Array.from({ length: PAYOUT_IDS_LIMIT + 1 }, (_, i) => `o${i}`);
    expect(chunkIds(ids.slice(0, PAYOUT_IDS_LIMIT))).toHaveLength(1);
    expect(chunkIds(ids).map(c => c.length)).toEqual([PAYOUT_IDS_LIMIT, 1]);
  });
  it('沒有訂單不發請求', () => {
    expect(chunkIds([])).toEqual([]);
  });
});
