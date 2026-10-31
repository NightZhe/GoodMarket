import { describe, expect, it } from 'vitest';
import { createEcpayClient } from './ecpayClient.ts';
import { fakeEcpay, TEST_CFG } from './ecpayTestKit.ts';

const AUTH_OK = { RtnCode: 1, RtnMsg: 'Success!', OrderInfo: { TradeNo: '2610190000000001', MerchantTradeNo: 'T1', TradeAmt: 120 }, CardInfo: { Card6No: '431195', Card4No: '2222' } };
const mk = (h: Parameters<typeof fakeEcpay>[0]) => { const f = fakeEcpay(h); return { ...f, client: createEcpayClient(TEST_CFG, f.fetchFn, () => 1_700_000_000_000) }; };
const authArgs = { merchantId: '3002607', merchantTradeNo: 'T1', amount: 120, bindCardId: 'BC1', memberId: 'm1', itemName: '好物集訂單', buyerEmail: 'a@b.co', tradeDate: '2026/10/19 12:00:00' };

describe('authorize（35630 幕後交易授權）', () => {
  it('成功 → authorized，帶綠界交易編號；請求用平台商模式', async () => {
    const { client, calls } = mk(() => AUTH_OK);
    const r = await client.authorize(authArgs);
    expect(r).toMatchObject({ kind: 'authorized', tradeNo: '2610190000000001' });
    expect(calls[0].path).toBe('/Merchant/CreatePaymentWithCardID');
    expect(calls[0].outerMerchantId).toBe('3003008');
    expect(calls[0].data).toMatchObject({ PlatformID: '3003008', MerchantID: '3002607', BindCardID: 'BC1', Need3D: 0,
      OrderInfo: { MerchantTradeNo: 'T1', TotalAmount: 120 }, ConsumerInfo: { MerchantMemberID: 'm1' } });
  });

  it('額度不足 10100252 → declined，不是卡片失效', async () => {
    const { client } = mk(() => ({ RtnCode: 10100252, RtnMsg: 'x' }));
    expect(await client.authorize(authArgs)).toMatchObject({ kind: 'declined', rtnCode: 10100252, cardInvalid: false });
  });

  it.each([10100251, 10100255, 10100256])('卡片失效 %i → declined 且 cardInvalid（不可再用同一張）', async (code) => {
    const { client } = mk(() => ({ RtnCode: code, RtnMsg: 'x' }));
    expect(await client.authorize(authArgs)).toMatchObject({ kind: 'declined', cardInvalid: true });
  });

  it('10300066 待確認 → unknown（不是失敗）', async () => {
    const { client } = mk(() => ({ RtnCode: 10300066, RtnMsg: 'x' }));
    expect((await client.authorize(authArgs)).kind).toBe('unknown');
  });

  it('逾時 → unknown', async () => {
    const { client } = mk(() => 'timeout');
    expect((await client.authorize(authArgs)).kind).toBe('unknown');
  });

  it('綠界回 500 → unknown', async () => {
    const { client } = mk(() => 'http500');
    expect((await client.authorize(authArgs)).kind).toBe('unknown');
  });

  it('封包被拒（TransCode 不是 1，例如時間戳錯）→ declined，沒有處理過', async () => {
    const { client } = mk(() => ({ transCode: 0, transMsg: 'timestamp' }));
    expect(await client.authorize(authArgs)).toMatchObject({ kind: 'declined', cardInvalid: false });
  });

  it('特約商店未開通收款（5000039）→ declined', async () => {
    const { client } = mk(() => ({ RtnCode: 5000039, RtnMsg: 'not activated' }));
    expect(await client.authorize(authArgs)).toMatchObject({ kind: 'declined', rtnCode: 5000039 });
  });
});

describe('inquire（查這筆授權在綠界的樣子）', () => {
  it('error_nopay → none（綠界沒有這筆）', async () => {
    const { client } = mk((p) => p.includes('Cashier') ? { RtnCode: 10100058, RtnMsg: 'no' } : { RtnMsg: 'error_nopay' });
    expect(await client.inquire({ merchantId: '3002607', merchantTradeNo: 'T1' })).toEqual({ kind: 'none' });
  });

  it('綠界真實回應：查無交易 RtnCode 10000185（本機實測，不是 error_nopay）→ none', async () => {
    const { client } = mk(() => ({ RtnCode: 10000185, RtnMsg: 'Cant not find the trade data' }));
    expect(await client.inquire({ merchantId: '3002607', merchantTradeNo: 'T1' })).toEqual({ kind: 'none' });
  });

  it('Authorized → 取得綠界交易編號與狀態', async () => {
    const { client } = mk((p) => p.includes('Cashier')
      ? { RtnCode: 1, OrderInfo: { TradeNo: 'E9', TradeAmt: 120 } }
      : { RtnMsg: '', RtnValue: { Status: 'Authorized', Amount: 120, ClsAmt: 0 }, CloseData: {} });
    expect(await client.inquire({ merchantId: '3002607', merchantTradeNo: 'T1' })).toEqual({ kind: 'found', tradeNo: 'E9', status: 'authorized', amount: 120, refunded: 0 });
  });

  it.each([['To be captured', 'to_capture'], ['Captured', 'captured'], ['Operation canceled', 'op_canceled'], ['Cancelled', 'cancelled'], ['Canceled', 'cancelled'], ['Unauthorized', 'unauthorized']])('狀態 %s → %s', async (raw, mapped) => {
    const { client } = mk((p) => p.includes('Cashier') ? { RtnCode: 1, OrderInfo: { TradeNo: 'E9', TradeAmt: 1 } } : { RtnMsg: '', RtnValue: { Status: raw, Amount: 1 }, CloseData: {} });
    expect(await client.inquire({ merchantId: '3002607', merchantTradeNo: 'T1' })).toMatchObject({ kind: 'found', status: mapped });
  });

  it('查詢逾時 → unknown', async () => {
    const { client } = mk(() => 'timeout');
    expect((await client.inquire({ merchantId: '3002607', merchantTradeNo: 'T1' })).kind).toBe('unknown');
  });
});

/** 模擬綠界對一筆交易的狀態機：DoAction 依動作改狀態 */
function statefulTrade(initial: string) {
  let status = initial;
  const actions: string[] = [];
  return {
    actions, get status() { return status; },
    handler: ((p: string, d: Record<string, any>) => {
      if (p.includes('Cashier/QueryTrade')) return { RtnCode: 1, OrderInfo: { TradeNo: 'E9', TradeAmt: 120 } };
      if (p.includes('CreditDetail/QueryTrade')) return { RtnMsg: '', RtnValue: { Status: status, Amount: 120 }, CloseData: {} };
      if (p.includes('Credit/DoAction')) {
        actions.push(d.Action);
        const t: Record<string, Record<string, string>> = {
          C: { Authorized: 'To be captured' }, N: { Authorized: 'Cancelled', 'Operation canceled': 'Cancelled' },
          E: { 'To be captured': 'Operation canceled' }, R: { Captured: 'Captured' },
        };
        const next = t[d.Action]?.[status];
        if (!next) return { RtnCode: 10000002, RtnMsg: '更新失敗.(error_closed)' };
        status = next; return { RtnCode: 1, RtnMsg: '更新訂單成功' };
      }
      return { RtnCode: 0 };
    }) as Parameters<typeof fakeEcpay>[0],
  };
}
const ref = { merchantId: '3002607', merchantTradeNo: 'T1', amount: 120 };

describe('capture（關帳 Action=C）', () => {
  it('已授權 → 送 C → done', async () => {
    const t = statefulTrade('Authorized'); const { client } = mk(t.handler);
    expect(await client.capture(ref)).toEqual({ kind: 'done' });
    expect(t.actions).toEqual(['C']);
  });
  it('已經是要關帳（自動關帳先動手）→ 不重送，done', async () => {
    const t = statefulTrade('To be captured'); const { client } = mk(t.handler);
    expect(await client.capture(ref)).toEqual({ kind: 'done' });
    expect(t.actions).toEqual([]);
  });
  it('已被放棄 → failed（不能再請款）', async () => {
    const t = statefulTrade('Cancelled'); const { client } = mk(t.handler);
    expect((await client.capture(ref)).kind).toBe('failed');
  });
  it('查詢逾時 → unknown，不亂打動作', async () => {
    const t = statefulTrade('Authorized'); const { client } = mk(() => 'timeout');
    expect((await client.capture(ref)).kind).toBe('unknown'); expect(t.actions).toEqual([]);
  });
});

describe('abandon（依綠界目前狀態選動作）', () => {
  it('已授權 → N', async () => {
    const t = statefulTrade('Authorized'); const { client } = mk(t.handler);
    expect(await client.abandon(ref)).toEqual({ kind: 'done' }); expect(t.actions).toEqual(['N']); expect(t.status).toBe('Cancelled');
  });
  it('要關帳（20:15 自動關帳先到）→ E 再 N', async () => {
    const t = statefulTrade('To be captured'); const { client } = mk(t.handler);
    expect(await client.abandon(ref)).toEqual({ kind: 'done' }); expect(t.actions).toEqual(['E', 'N']); expect(t.status).toBe('Cancelled');
  });
  it('已關帳 → 退刷 R（全額）', async () => {
    const t = statefulTrade('Captured'); const { client } = mk(t.handler);
    expect(await client.abandon(ref)).toEqual({ kind: 'done' }); expect(t.actions).toEqual(['R']);
  });
  it('操作取消 → N', async () => {
    const t = statefulTrade('Operation canceled'); const { client } = mk(t.handler);
    expect(await client.abandon(ref)).toEqual({ kind: 'done' }); expect(t.actions).toEqual(['N']);
  });
  it('已經 Cancelled → 不再動作（冪等）', async () => {
    const t = statefulTrade('Cancelled'); const { client } = mk(t.handler);
    expect(await client.abandon(ref)).toEqual({ kind: 'done' }); expect(t.actions).toEqual([]);
  });
  it('綠界沒有這筆 → done（沒有東西要放）', async () => {
    const { client } = mk((p) => p.includes('Cashier') ? { RtnCode: 10100058 } : { RtnMsg: 'error_nopay' });
    expect(await client.abandon(ref)).toEqual({ kind: 'done' });
  });
  it('銀行沒授權（Unauthorized）→ 沒有佔額，done', async () => {
    const t = statefulTrade('Unauthorized'); const { client } = mk(t.handler);
    expect(await client.abandon(ref)).toEqual({ kind: 'done' }); expect(t.actions).toEqual([]);
  });
  it('動作被綠界拒絕且狀態沒變 → failed', async () => {
    const { client } = mk((p, d) => p.includes('DoAction') ? { RtnCode: 10000002, RtnMsg: 'error_overDate' }
      : p.includes('Cashier') ? { RtnCode: 1, OrderInfo: { TradeNo: 'E9', TradeAmt: 120 } } : { RtnMsg: '', RtnValue: { Status: 'Authorized', Amount: 120 }, CloseData: {} });
    expect((await client.abandon(ref)).kind).toBe('failed');
  });
});

describe('綁卡 API', () => {
  it('getBindToken：外層與 Data.PlatformID 都是平台商，Data.MerchantID 是綁卡用特店', async () => {
    const { client, calls } = mk(() => ({ RtnCode: 1, Token: 'tok', TokenExpireDate: '2026/10/19 13:00:00' }));
    const r = await client.getBindToken({ bindMerchantId: '3002607', memberId: 'm1', email: 'a@b.co', merchantTradeNo: 'B1', tradeDate: '2026/10/19 12:00:00', amount: 500, returnUrl: 'https://f/r', orderResultUrl: 'https://f/o' });
    expect(r).toEqual({ ok: true, token: 'tok', expiresAt: '2026/10/19 13:00:00' });
    expect(calls[0].path).toBe('/Merchant/GetTokenbyBindingCard');
    expect(calls[0].outerMerchantId).toBe('3003008');
    expect(calls[0].data).toMatchObject({ PlatformID: '3003008', MerchantID: '3002607', ConsumerInfo: { MerchantMemberID: 'm1', Email: 'a@b.co' }, OrderInfo: { MerchantTradeNo: 'B1', TotalAmount: 500, ReturnURL: 'https://f/r' }, OrderResultURL: 'https://f/o' });
  });
  it('queryBindCards：回卡片清單（含 BindCardID，只給伺服器內部用）', async () => {
    const { client } = mk(() => ({ RtnCode: 1, BindCardList: [{ Card6No: '431195', Card4No: '2222', CardValidYY: '30', CardValidMM: '12', BindCardID: 'BC1' }] }));
    expect(await client.queryBindCards({ bindMerchantId: '3002607', memberId: 'm1' })).toEqual({ ok: true, cards: [{ card6: '431195', card4: '2222', expYear: '30', expMonth: '12', bindCardId: 'BC1' }] });
  });
  it('queryBindCards：會員沒有任何綁卡時綠界回 5100088（B-0 實測，文件沒寫）→ 視為 0 張，不是查詢失敗', async () => {
    const { client } = mk(() => ({ PlatformID: null, MerchantID: null, MerchantMemberID: null, BindCardList: null, RtnCode: 5100088, RtnMsg: 'The BindCard does not exist.' }));
    expect(await client.queryBindCards({ bindMerchantId: '3002607', memberId: 'm1' })).toEqual({ ok: true, cards: [] });
  });
  it('queryBindCards：其他錯誤碼 → 失敗，並帶回綠界的代碼與訊息（給管理刪卡回報用）', async () => {
    const { client } = mk(() => ({ RtnCode: 5100011, RtnMsg: 'The parameter [MerchantMemberID] Incorrect format' }));
    expect(await client.queryBindCards({ bindMerchantId: '3002607', memberId: 'm1' })).toEqual({ ok: false, rtnCode: 5100011, rtnMsg: 'The parameter [MerchantMemberID] Incorrect format' });
  });
  it('queryBindCards：逾時 → 失敗，rtnCode null、rtnMsg timeout', async () => {
    const { client } = mk(() => 'timeout');
    expect(await client.queryBindCards({ bindMerchantId: '3002607', memberId: 'm1' })).toEqual({ ok: false, rtnCode: null, rtnMsg: 'timeout' });
  });
  it('deleteBindCard：RtnCode 1 → ok', async () => {
    const { client, calls } = mk(() => ({ RtnCode: 1 }));
    expect(await client.deleteBindCard({ bindMerchantId: '3002607', bindCardId: 'BC1' })).toEqual({ kind: 'done' });
    expect(calls[0].path).toBe('/Merchant/DeleteMemberBindCard');
  });
  it('deleteBindCard：卡不存在（5100088）→ failed，帶回綠界的代碼與訊息（判斷「已不存在」交給呼叫端反查清單）', async () => {
    const { client } = mk(() => ({ RtnCode: 5100088, RtnMsg: 'The BindCard does not exist.' }));
    expect(await client.deleteBindCard({ bindMerchantId: '3002607', bindCardId: 'BC1' })).toEqual({ kind: 'failed', rtnCode: 5100088, rtnMsg: 'The BindCard does not exist.' });
  });
  it('deleteBindCard：逾時 → unknown，原因 timeout', async () => {
    const { client } = mk(() => 'timeout');
    expect(await client.deleteBindCard({ bindMerchantId: '3002607', bindCardId: 'BC1' })).toEqual({ kind: 'unknown', reason: 'timeout' });
  });
});

describe('createBindCard（35596）', () => {
  const args = { bindMerchantId: '3002607', memberId: 'm1', bindCardPayToken: 'bpt' };
  it('不需 3D → bound，帶卡片資料與 IsSameCard', async () => {
    const { client, calls } = mk(() => ({ RtnCode: 1, BindCardID: 'BC1', IsSameCard: false, CardInfo: { Card6No: '431195', Card4No: '2222', CardValidYY: '30', CardValidMM: '12' },
      OrderInfo: { MerchantTradeNo: 'B1', TradeNo: 'E5', TradeAmt: 500 } }));
    const r = await client.createBindCard(args);
    expect(r).toMatchObject({ kind: 'bound', bindCardId: 'BC1', isSameCard: false, card6: '431195', card4: '2222', expYear: '30', expMonth: '12', tradeNo: 'E5', merchantTradeNo: 'B1' });
    expect(calls[0].data).toMatchObject({ PlatformID: '3003008', MerchantID: '3002607', BindCardPayToken: 'bpt', MerchantMemberID: 'm1' });
  });
  it('要 3D → need3d 帶網址', async () => {
    const { client } = mk(() => ({ RtnCode: 1, ThreeDInfo: { ThreeDURL: 'https://3d.example/x' }, OrderInfo: { MerchantTradeNo: 'B1' } }));
    expect(await client.createBindCard(args)).toEqual({ kind: 'need3d', url: 'https://3d.example/x', merchantTradeNo: 'B1' });
  });
  it('發卡行拒絕 → failed', async () => {
    const { client } = mk(() => ({ RtnCode: 10100248, RtnMsg: 'no' }));
    expect(await client.createBindCard(args)).toMatchObject({ kind: 'failed', rtnCode: 10100248 });
  });
  it('逾時 → unknown（要靠查詢綁卡清單反查）', async () => {
    const { client } = mk(() => 'timeout');
    expect((await client.createBindCard(args)).kind).toBe('unknown');
  });
});

/**
 * 退款用的綠界交易模擬：照 35637／35642／35662 的描述保存「主狀態」與關帳明細 CloseData。
 * 退刷 R 會在明細加一筆負向金額（狀態「要關帳」），而且主狀態跟著變成「要關帳」——
 * 這正是 35637 要求「看明細裡最後一筆正向金額的狀態」的原因（只看主狀態會誤做 E＋N）。
 * 負向明細的表示法是依文件推論（未查證，正式環境 AC-RF30 實刷時確認）。
 */
function refundTrade(initial: string, opt: { rTimeout?: boolean; rReject?: string; eReject?: boolean; rAppliedButRejected?: boolean; queryDownAfterR?: number } = {}) {
  let queryDown = 0;
  let status = initial;
  const close: { Status: string; Amount: number; DateTime: string }[] =
    ['To be captured', 'Captured', 'Operation canceled'].includes(initial) ? [{ Status: initial, Amount: 120, DateTime: '2026/10/20 10:00:00' }] : [];
  const actions: string[] = [];
  const positive = () => [...close].reverse().find((c) => c.Amount > 0);
  const refunded = () => close.filter((c) => c.Amount < 0).reduce((s, c) => s - c.Amount, 0);
  return {
    actions, close, get status() { return status; },
    handler: ((p: string, d: Record<string, any>) => {
      if (p.includes('QueryTrade') && queryDown > 0) { queryDown--; return 'timeout'; }
      if (p.includes('Cashier/QueryTrade')) return { RtnCode: 1, OrderInfo: { TradeNo: 'E9', TradeAmt: 120 } };
      if (p.includes('CreditDetail/QueryTrade')) return { RtnMsg: '', RtnValue: { Status: status, Amount: 120, ClsAmt: 120 - refunded() }, CloseData: close.length ? close : {} };
      if (p.includes('Credit/DoAction')) {
        actions.push(d.Action);
        const eff = positive()?.Status ?? status;
        if (d.Action === 'N' && (eff === 'Authorized' || eff === 'Operation canceled' || status === 'Authorized')) { status = 'Cancelled'; return { RtnCode: 1, RtnMsg: 'ok' }; }
        if (d.Action === 'E' && eff === 'To be captured' && !opt.eReject) { positive()!.Status = 'Operation canceled'; status = 'Operation canceled'; return { RtnCode: 1, RtnMsg: 'ok' }; }
        if (d.Action === 'R' && eff === 'Captured') {
          if (opt.rReject) return { RtnCode: 10000099, RtnMsg: opt.rReject };
          if (refunded() + d.TotalAmount > 120) return { RtnCode: 10000002, RtnMsg: '更新失敗.(error_amount)' };
          close.push({ Status: 'To be captured', Amount: -d.TotalAmount, DateTime: '2026/10/21 10:00:00' }); status = 'To be captured';
          queryDown = opt.queryDownAfterR ?? 0;
          if (opt.rTimeout) return 'timeout';
          if (opt.rAppliedButRejected) return { RtnCode: 10000002, RtnMsg: '更新失敗.(error_amount)' };
          return { RtnCode: 1, RtnMsg: 'ok' };
        }
        return { RtnCode: 10000002, RtnMsg: '更新失敗.(error_closed)' };
      }
      return { RtnCode: 0 };
    }) as Parameters<typeof fakeEcpay>[0],
  };
}

describe('refund（已付款訂單全額退款：依綠界狀態選 N／E＋N／R，並在 R 前後讀關帳明細）', () => {
  it('已授權 → N，方式＝取消授權', async () => {
    const t = refundTrade('Authorized'); const { client } = mk(t.handler);
    expect(await client.refund(ref)).toMatchObject({ kind: 'done', method: 'void' });
    expect(t.actions).toEqual(['N']); expect(t.status).toBe('Cancelled');
  });
  it('要關帳（付款當天）→ E 再 N，方式＝取消授權（AC-RF15）', async () => {
    const t = refundTrade('To be captured'); const { client } = mk(t.handler);
    expect(await client.refund(ref)).toMatchObject({ kind: 'done', method: 'void' });
    expect(t.actions).toEqual(['E', 'N']); expect(t.status).toBe('Cancelled');
  });
  it('已關帳 → 退刷 R 全額，方式＝退刷（AC-RF16）', async () => {
    const t = refundTrade('Captured'); const { client, calls } = mk(t.handler);
    expect(await client.refund(ref)).toMatchObject({ kind: 'done', method: 'card_refund' });
    expect(t.actions).toEqual(['R']);
    expect(calls.find((c) => c.data.Action === 'R')!.data).toMatchObject({ MerchantID: '3002607', MerchantTradeNo: 'T1', TradeNo: 'E9', TotalAmount: 120 });
  });
  it('C-13：R 回應逾時、其實已退成功 → 動作後馬上讀明細看到退刷 → 退刷完成', async () => {
    const t = refundTrade('Captured', { rTimeout: true }); const { client } = mk(t.handler);
    expect(await client.refund(ref)).toMatchObject({ kind: 'done', method: 'card_refund' });
    expect(t.actions).toEqual(['R']);
  });
  it('C-13：R 逾時而且動作後查詢也失敗 → 這次結果不明；下一輪先讀明細看到退刷 → 記為退刷完成，不發第二次 R、也不誤做 E（AC-RF17）', async () => {
    const t = refundTrade('Captured', { rTimeout: true, queryDownAfterR: 1 }); const { client } = mk(t.handler);
    expect(await client.refund(ref)).toMatchObject({ kind: 'unknown', action: 'R' });
    // 退刷後主狀態變成「要關帳」（退刷那一筆），但最後一筆正向明細仍是「已關帳」
    expect(t.status).toBe('To be captured');
    expect(await client.refund(ref)).toMatchObject({ kind: 'done', method: 'card_refund' });
    expect(t.actions).toEqual(['R']);
  });
  it('C-13：R 被拒，但動作後讀明細發現已有全額退刷（例如前一次其實成功）→ 退刷完成，不記成失敗', async () => {
    const t = refundTrade('Captured', { rAppliedButRejected: true }); const { client } = mk(t.handler);
    expect(await client.refund(ref)).toMatchObject({ kind: 'done', method: 'card_refund' });
    expect(t.actions).toEqual(['R']);
  });
  it('R 被拒且明細沒有退刷，綠界訊息是餘額不足 → failed，hint＝balance（AC-RF20）', async () => {
    const t = refundTrade('Captured', { rReject: '帳戶餘額不足，無法退刷' }); const { client } = mk(t.handler);
    expect(await client.refund(ref)).toMatchObject({ kind: 'failed', action: 'R', rtnCode: 10000099, hint: 'balance' });
  });
  it('R 被拒、其他原因 → failed，hint＝null（交給重試）', async () => {
    const t = refundTrade('Captured', { rReject: 'error_other' }); const { client } = mk(t.handler);
    expect(await client.refund(ref)).toMatchObject({ kind: 'failed', action: 'R', hint: null });
  });
  it('E 被拒（系統自動關帳，授權隔日 6:00 前）且仍是要關帳 → failed（action E，交給重試，不是人工）；之後變已關帳 → 改走 R 成功（AC-RF18）', async () => {
    const t = refundTrade('To be captured', { eReject: true }); const { client } = mk(t.handler);
    expect(await client.refund(ref)).toMatchObject({ kind: 'failed', action: 'E', hint: null, ecpayStatus: 'to_capture' });
    t.close[0].Status = 'Captured'; // 綠界批次請款完成
    expect(await client.refund(ref)).toMatchObject({ kind: 'done', method: 'card_refund' });
    expect(t.actions).toEqual(['E', 'R']);
  });
  it('綠界查無這筆 → 不能當成退款完成（已付款的訂單一定有已請款的交易；查無＝資料或特約商店編號不對）→ failed，交給重試／36 小時轉人工', async () => {
    // t7 整合測試抓到：特約商店編號不對時綠界測試環境回 10000185，舊規則（查無＝完成）會把沒退的錢記成已退款
    const none = mk(() => ({ RtnCode: 10000185, RtnMsg: 'Cant not find the trade data' }));
    expect(await none.client.refund(ref)).toMatchObject({ kind: 'failed', action: 'query', hint: null, ecpayStatus: null });
    expect(none.calls.some((c) => c.path.includes('DoAction'))).toBe(false);
  });
  it('結帳的「放棄」維持舊規則：查無這筆 → 完成（授權可能根本沒成立）', async () => {
    const none = mk(() => ({ RtnCode: 10000185, RtnMsg: 'Cant not find the trade data' }));
    expect(await none.client.abandon(ref)).toEqual({ kind: 'done' });
  });
  it('綠界已取消 → 視為完成（取消授權），不打任何動作', async () => {
    const t = refundTrade('Cancelled'); const { client } = mk(t.handler);
    expect(await client.refund(ref)).toMatchObject({ kind: 'done', method: 'void' }); expect(t.actions).toEqual([]);
  });
  it('查詢回 error_Stop（查無商家或商家已到期）→ failed，hint＝stop（要人工）', async () => {
    const { client } = mk(() => ({ RtnMsg: 'error_Stop' }));
    expect(await client.refund(ref)).toMatchObject({ kind: 'failed', action: 'query', hint: 'stop' });
  });
  it('查詢逾時 → unknown，不打任何動作', async () => {
    const { client, calls } = mk(() => 'timeout');
    expect(await client.refund(ref)).toMatchObject({ kind: 'unknown', action: 'query' });
    expect(calls.some((c) => c.path.includes('DoAction'))).toBe(false);
  });
  it('結帳的「放棄」也受惠於 C-13：已關帳且明細已有全額退刷 → abandon 直接完成，不發第二次 R', async () => {
    const t = refundTrade('Captured', { rTimeout: true, queryDownAfterR: 1 }); const { client } = mk(t.handler);
    expect((await client.abandon(ref)).kind).toBe('unknown');
    expect(await client.abandon(ref)).toEqual({ kind: 'done' });
    expect(t.actions).toEqual(['R']);
  });
});

// ── 平台收款（PR-乙，IN-B3／R12）：一般特店模式不帶 PlatformID，外層與 Data 的 MerchantID 都是本站商店編號 ──
describe('一般特店模式（platformId 不設）', () => {
  const MERCHANT_CFG = { ...TEST_CFG, platformId: undefined, merchantId: '3002607' };
  const mkM = (h: Parameters<typeof fakeEcpay>[0]) => { const f = fakeEcpay(h); return { ...f, client: createEcpayClient(MERCHANT_CFG, f.fetchFn, () => 1_700_000_000_000) }; };
  it('authorize：外層 MerchantID＝本站商店編號，Data 沒有 PlatformID', async () => {
    const { client, calls } = mkM(() => AUTH_OK);
    expect((await client.authorize(authArgs)).kind).toBe('authorized');
    expect(calls[0].outerMerchantId).toBe('3002607');
    expect(calls[0].data).not.toHaveProperty('PlatformID');
    expect(calls[0].data).toMatchObject({ MerchantID: '3002607', BindCardID: 'BC1' });
  });
  it('getBindToken／createBindCard／deleteBindCard：同樣不帶 PlatformID', async () => {
    const { client, calls } = mkM((p) => p.includes('GetToken') ? { RtnCode: 1, Token: 'tok', TokenExpireDate: 'x' } : { RtnCode: 1 });
    await client.getBindToken({ bindMerchantId: '3002607', memberId: 'm1', merchantTradeNo: 'B1', tradeDate: 'd', amount: 500, returnUrl: 'https://f/r', orderResultUrl: 'https://f/o' });
    await client.deleteBindCard({ bindMerchantId: '3002607', bindCardId: 'BC1' });
    for (const c of calls) {
      expect(c.outerMerchantId).toBe('3002607');
      expect(c.data).not.toHaveProperty('PlatformID');
      expect(c.data.MerchantID).toBe('3002607');
    }
  });
  it('inquire／DoAction：查詢與請退款也不帶 PlatformID', async () => {
    const { client, calls } = mkM((p) => p.includes('DoAction') ? { RtnCode: 1 }
      : p.includes('Cashier') ? { RtnCode: 1, OrderInfo: { TradeNo: 'E9', TradeAmt: 120 } } : { RtnMsg: '', RtnValue: { Status: 'Captured', Amount: 120 }, CloseData: {} });
    expect((await client.refund({ merchantId: '3002607', merchantTradeNo: 'T1', amount: 120 })).kind).toBe('done');
    expect(calls.length).toBeGreaterThanOrEqual(3);
    for (const c of calls) { expect(c.outerMerchantId).toBe('3002607'); expect(c.data).not.toHaveProperty('PlatformID'); }
  });
  it('平台商模式（對照）：外層是平台商、Data 帶 PlatformID、MerchantID 是傳入的收款特店', async () => {
    const { client, calls } = mk(() => AUTH_OK);
    await client.authorize({ ...authArgs, merchantId: '3002607' });
    expect(calls[0].outerMerchantId).toBe('3003008');
    expect(calls[0].data).toMatchObject({ PlatformID: '3003008', MerchantID: '3002607' });
  });
});
