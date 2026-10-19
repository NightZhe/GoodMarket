import { describe, expect, it } from 'vitest';
import { driveGroup } from './paymentRunner.ts';
import { fakeGateway, memoryStore } from './paymentTestKit.ts';
import type { AuthRow } from './paymentTypes.ts';

const T0 = Date.UTC(2026, 9, 19, 4, 0, 0); // 台灣 12:00
const row = (id: string, merchantId: string, over: Partial<AuthRow> = {}): AuthRow => ({
  id, orderId: 'o-' + id, shopId: 's-' + id, merchantId, merchantTradeNo: 'T' + id, amount: 100 + id.length, state: 'pending',
  ecpayTradeNo: null, rtnCode: null, rtnMsg: null, callStartedAt: null, actionFailures: 0, resolvedByQuery: false, ...over,
});
const ctx = { bindCardId: 'BC', memberId: 'm', buyerEmail: 'a@b.co', itemName: 'x', tradeDate: '2026/10/19 12:00:00' };
const run = (s: ReturnType<typeof memoryStore>, g: ReturnType<typeof fakeGateway>, now = T0, allowAuthorize = true) =>
  driveGroup({ store: s.store, gateway: g.g, now: () => now }, 'g1', { allowAuthorize, authorizeCtx: ctx });
const A = () => row('A', '3002607'), B = () => row('B', '2000132');

describe('driveGroup: 結帳付款（AC-E4 / AC-E5）', () => {
  it('兩家都授權成功 → 兩筆都請款 → 已付款；順序是先全部授權、再請款', async () => {
    const s = memoryStore([A(), B()]); const g = fakeGateway();
    const r = await run(s, g);
    expect(r.outcome).toBe('paid');
    expect(g.log.filter((x) => x.startsWith('authorize')).sort()).toEqual(['authorize:2000132', 'authorize:3002607']);
    const firstCapture = g.log.findIndex((x) => x.startsWith('capture'));
    expect(g.log.slice(0, firstCapture).filter((x) => x.startsWith('authorize'))).toHaveLength(2);
    expect([...s.rows.values()].map((x) => x.state)).toEqual(['captured', 'captured']);
    expect(s.st.finalized).toEqual(['paid']);
  });

  it('B 店被拒 → A 店已授權的被放棄、全程沒有請款 → 失敗，指出是哪一家', async () => {
    const s = memoryStore([A(), B()]);
    const g = fakeGateway({ authorize: { '2000132': { kind: 'declined', rtnCode: 10100252, rtnMsg: 'x', cardInvalid: false } } });
    const r = await run(s, g);
    expect(r.outcome).toBe('failed');
    expect(r.outcome === 'failed' && r.failure).toMatchObject({ shopId: 's-B', orderId: 'o-B', rtnCode: 10100252, cardInvalid: false });
    expect(g.log.some((x) => x.startsWith('capture'))).toBe(false);
    expect(g.log).toContain('abandon:3002607');
    expect(s.rows.get('A')!.state).toBe('abandoned');
    expect(s.rows.get('B')!.state).toBe('declined');
    expect(s.st.finalized).toEqual(['failed']);
  });

  it('卡片失效（cardInvalid）要帶到失敗資訊，讓前端提示刪卡換卡', async () => {
    const s = memoryStore([A()]);
    const g = fakeGateway({ authorize: { '3002607': { kind: 'declined', rtnCode: 10100251, rtnMsg: 'x', cardInvalid: true } } });
    const r = await run(s, g);
    expect(r.outcome === 'failed' && r.failure.cardInvalid).toBe(true);
  });

  it('單店也走同一條路', async () => {
    const s = memoryStore([A()]); const g = fakeGateway();
    expect((await run(s, g)).outcome).toBe('paid');
  });
});

describe('driveGroup: 結果不明與補償（AC-E6）', () => {
  it('B 授權逾時 → 確認中；不請款、也不放棄 A（B 可能已授權）', async () => {
    const s = memoryStore([A(), B()]); const g = fakeGateway({ authorize: { '2000132': { kind: 'unknown', reason: 'TimeoutError' } } });
    const r = await run(s, g);
    expect(r.outcome).toBe('confirming');
    expect(g.log.some((x) => x.startsWith('capture') || x.startsWith('abandon'))).toBe(false);
    expect(s.st.status).toBe('confirming');
    expect(s.rows.get('B')!.state).toBe('calling');
  });

  it('60 秒後補償：查到 B 其實授權成功 → 請款 → 已付款（一家都不落單）', async () => {
    const s = memoryStore([A(), B()]); const g1 = fakeGateway({ authorize: { '2000132': { kind: 'unknown', reason: 'TimeoutError' } } });
    await run(s, g1);
    const g2 = fakeGateway({ inquire: { '2000132': { kind: 'found', tradeNo: 'E-B', status: 'authorized', amount: 101 } } });
    const r = await run(s, g2, T0 + 61_000, false);
    expect(r.outcome).toBe('paid');
    expect([...s.rows.values()].map((x) => x.state)).toEqual(['captured', 'captured']);
    expect(s.rows.get('B')!.ecpayTradeNo).toBe('E-B');
  });

  it('查到綠界沒有 B：不足 10 分鐘還不下結論（可能是銀行慢回）；滿 10 分鐘才當作失敗並放棄 A', async () => {
    const s = memoryStore([A(), B()]); const g1 = fakeGateway({ authorize: { '2000132': { kind: 'unknown', reason: 'TimeoutError' } } });
    await run(s, g1);
    const gNone = () => fakeGateway({ inquire: { '2000132': { kind: 'none' } } });
    const early = await run(s, gNone(), T0 + 120_000, false);
    expect(early.outcome).toBe('confirming');
    const g3 = gNone();
    const late = await run(s, g3, T0 + 11 * 60_000, false);
    expect(late.outcome).toBe('failed');
    expect(g3.log).toContain('abandon:3002607');
    expect(s.rows.get('B')!.state).toBe('declined');
    expect(s.rows.get('B')!.resolvedByQuery).toBe(true);
    expect(g3.log.some((x) => x.startsWith('capture'))).toBe(false);
  });

  it('行程在寫入意圖後、打綠界前中斷（全是 pending，補償不授權）→ 放棄這次嘗試、可重付', async () => {
    const s = memoryStore([A(), B()]); const g = fakeGateway();
    const r = await run(s, g, T0, false);
    expect(r.outcome).toBe('failed');
    expect(g.log).toEqual([]);
    expect([...s.rows.values()].map((x) => x.state)).toEqual(['abandoned', 'abandoned']);
  });

  it('行程在請款中途中斷（A 已 captured、B 還 authorized，決定=請款）→ 補償把 B 補請款，不會半套', async () => {
    const s = memoryStore([A(), B()], 'capture');
    s.rows.get('A')!.state = 'captured'; s.rows.get('B')!.state = 'authorized';
    const g = fakeGateway();
    const r = await run(s, g, T0, false);
    expect(r.outcome).toBe('paid');
    expect(g.log).toEqual(['capture:2000132']);
  });

  it('請款中途 B 反覆關帳失敗 → 改成全部放棄（A 已請款的退掉），不會一家請款一家沒請款', async () => {
    const s = memoryStore([A(), B()]);
    const g = fakeGateway({ capture: { '2000132': { kind: 'failed', rtnMsg: 'error_overDate' } } });
    const r = await run(s, g);
    expect(r.outcome).toBe('failed');
    expect(g.log).toContain('abandon:3002607');   // A 已關帳 → 放棄（綠界端會走退刷）
    expect(g.log).toContain('abandon:2000132');
    expect([...s.rows.values()].map((x) => x.state)).toEqual(['abandoned', 'abandoned']);
    expect(s.st.setDecisionCalls).toBe(2); // capture → abandon
  });
});

describe('driveGroup: 安全網', () => {
  it('放棄動作反覆失敗 → 確認中（卡住），絕不收尾成失敗（會留下活的授權）', async () => {
    const s = memoryStore([A(), B()]);
    const g = fakeGateway({ authorize: { '2000132': { kind: 'declined', rtnCode: 10100252, rtnMsg: '', cardInvalid: false } }, abandon: { '3002607': { kind: 'failed', rtnMsg: 'x' } } });
    const r = await run(s, g);
    expect(r.outcome).toBe('confirming');
    expect(r.outcome === 'confirming' && r.reason).toBe('stuck');
    expect(s.rows.get('A')!.actionFailures).toBe(3);
    expect(s.st.finalized).toEqual([]);
  });

  it('關帳空窗（台灣 20:15）→ 授權完先不動，確認中；空窗過後補償完成請款', async () => {
    const t = Date.UTC(2026, 9, 19, 12, 15, 0);
    const s = memoryStore([A(), B()]); const g = fakeGateway();
    const r = await run(s, g, t);
    expect(r.outcome).toBe('confirming'); expect(r.outcome === 'confirming' && r.reason).toBe('blackout');
    expect(g.log.some((x) => x.startsWith('capture'))).toBe(false);
    const g2 = fakeGateway();
    expect((await run(s, g2, t + 30 * 60_000, false)).outcome).toBe('paid');
  });

  it('已經收尾的群組再跑一次不會再打綠界（冪等）', async () => {
    const s = memoryStore([A(), B()]); await run(s, fakeGateway());
    const g2 = fakeGateway();
    // 已付款後狀態都是 captured、決定=capture
    expect((await run(s, g2, T0 + 5000, false)).outcome).toBe('paid');
    expect(g2.log).toEqual([]);
  });

  it('查詢也失敗（網路壞了）→ 確認中，不亂判', async () => {
    const s = memoryStore([A()]); const g1 = fakeGateway({ authorize: { '3002607': { kind: 'unknown', reason: 'x' } } });
    await run(s, g1);
    const r = await run(s, fakeGateway({ inquire: { '3002607': { kind: 'unknown' } } }), T0 + 90_000, false);
    expect(r.outcome).toBe('confirming');
  });
});
