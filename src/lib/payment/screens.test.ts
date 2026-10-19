import { describe, expect, it } from 'vitest';
import type { FailureInfo, PayResponse, PaymentErrorCode, PaymentGroupView } from './types';
import {
  CONFIRM_POLL, destinationOfPayError, destinationOfPayResponse, failureSentences, pollAction, screenOfGroup, SLOW_PAY_MS, WAIT_PAY_MS,
} from './screens';

const group = (over: Partial<PaymentGroupView> = {}): PaymentGroupView => ({
  groupId: 'g1', status: 'pending', attemptNo: 1, total: 1490, expiresAt: '2026-10-19T08:30:00Z', paidAt: null, lastFail: null, orders: [], ...over,
});
const fail = (over: Partial<FailureInfo> = {}): FailureInfo & { attemptNo: number; at: string } =>
  ({ shopId: 's2', orderId: 'o2', rtnCode: 10100252, message: '這張卡的額度或餘額不足，請換一張卡。', cardInvalid: false, attemptNo: 1, at: 'x', ...over });

describe('screenOfGroup：付款群組狀態 → 結果頁畫面', () => {
  it.each([
    ['paid', 'paid'],
    ['confirming', 'confirming'],
    ['processing', 'confirming'],   // 有請求還在跑（例如別的分頁）：也不能再付
    ['expired', 'expired'],
    ['cancelled', 'cancelled'],
    ['failed', 'exhausted'],        // 5 次用盡、已作廢
  ] as const)('%s → %s', (status, screen) => {
    expect(screenOfGroup(group({ status }))).toBe(screen);
  });
  it('pending 沒有失敗紀錄：完成付款；有失敗紀錄：失敗＋重付', () => {
    expect(screenOfGroup(group())).toBe('pay');
    expect(screenOfGroup(group({ lastFail: fail() }))).toBe('failed');
  });
});

describe('destinationOfPayResponse：payment-pay 的三種回應各自去哪', () => {
  const base = { ok: true as const, groupId: 'g1', group: group() };
  it('paid／failed／confirming', () => {
    expect(destinationOfPayResponse({ ...base, outcome: 'paid' } as PayResponse)).toBe('paid');
    expect(destinationOfPayResponse({ ...base, outcome: 'failed', failure: fail() } as PayResponse)).toBe('failed');
    expect(destinationOfPayResponse({ ...base, outcome: 'confirming', reason: 'timeout' } as PayResponse)).toBe('confirming');
  });
});

describe('destinationOfPayError：錯誤碼 → 該去哪個畫面（null＝留在原地顯示訊息）', () => {
  it.each<[PaymentErrorCode, string | null]>([
    ['ALREADY_PAID', 'paid'],
    ['PAYMENT_IN_PROGRESS', 'confirming'],
    ['ORDER_EXPIRED', 'expired'],
    ['GROUP_NOT_FOUND', 'notfound'],
    ['CARD_NOT_FOUND', null],
    ['SHOP_NOT_ONLINE', null],
    ['ONLINE_AMOUNT_LIMIT', null],
    ['PAYMENT_DISABLED', null],
    ['NOT_AUTHENTICATED', null],
    ['INTERNAL', null],
  ])('%s → %s', (code, dest) => {
    expect(destinationOfPayError(code)).toBe(dest);
  });
});

describe('failureSentences：失敗頁的原因句與結果句', () => {
  it('銀行拒絕：寫出是哪一家，其他家的授權已取消，訂單保留', () => {
    const s = failureSentences(fail(), { failedShop: '小日子選物', otherShops: ['好物小舖'], orderCount: 2 });
    expect(s.reason).toBe('「小日子選物」的付款沒有通過：這張卡的額度或餘額不足，請換一張卡。');
    expect(s.result).toBe('「好物小舖」的授權已經取消，沒有向你的卡片請款。2 筆訂單先幫你保留。');
  });
  it('只有一家店：不寫「其他家」，只說沒有請款', () => {
    const s = failureSentences(fail(), { failedShop: '小日子選物', otherShops: [], orderCount: 1 });
    expect(s.result).toBe('沒有向你的卡片請款。1 筆訂單先幫你保留。');
  });
  it('系統問題（沒有指出哪一家）：用固定的「不是你的卡片有問題」', () => {
    const s = failureSentences(fail({ shopId: null, message: 'x' }), { failedShop: null, otherShops: [], orderCount: 2 });
    expect(s.reason).toBe('綠界科技暫時無法處理這次付款，不是你的卡片有問題。可以再試一次。');
    expect(s.result).toBe('沒有向你的卡片請款。2 筆訂單先幫你保留。');
  });
  it('卡片已失效：多一句提醒刪除這張卡', () => {
    const s = failureSentences(fail({ cardInvalid: true }), { failedShop: 'A', otherShops: [], orderCount: 1 });
    expect(s.cardInvalid).toBe(true);
  });
});

describe('確認中的輪詢與等待時間', () => {
  it('結帳按下付款：8 秒補一句、45 秒轉確認中', () => {
    expect(SLOW_PAY_MS).toBe(8_000);
    expect(WAIT_PAY_MS).toBe(45_000);
  });
  it('輪詢：確認中才輪詢，3 秒一次，最多 3 分鐘，超過就停下來給「重新整理」', () => {
    expect(pollAction('confirming', 0)).toEqual({ poll: true, delayMs: CONFIRM_POLL.intervalMs });
    expect(pollAction('confirming', CONFIRM_POLL.maxMs - 1).poll).toBe(true);
    expect(pollAction('confirming', CONFIRM_POLL.maxMs).poll).toBe(false);
    expect(CONFIRM_POLL.intervalMs).toBe(3_000);
    expect(CONFIRM_POLL.maxMs).toBe(180_000);
  });
  it('其他畫面不輪詢（結果已確定，或在等使用者操作）', () => {
    for (const s of ['paid', 'failed', 'pay', 'expired', 'cancelled', 'exhausted'] as const) expect(pollAction(s, 0).poll).toBe(false);
  });
});
