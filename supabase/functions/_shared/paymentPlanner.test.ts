import { describe, expect, it } from 'vitest';
import { planStep, isDoActionBlackout } from './paymentPlanner.ts';
import type { AuthRow, AuthState, GroupDecision } from './paymentTypes.ts';

const NOW = Date.UTC(2026, 9, 19, 4, 0, 0); // 台灣 12:00，不在關帳空窗
let seq = 0;
const auth = (state: AuthState, over: Partial<AuthRow> = {}): AuthRow => ({
  id: `a${++seq}`, orderId: `o${seq}`, shopId: `s${seq}`, merchantId: '3002607', merchantTradeNo: `T${seq}`, amount: 100, state,
  ecpayTradeNo: state === 'pending' ? null : `E${seq}`, rtnCode: null, rtnMsg: null,
  callStartedAt: state === 'pending' ? null : NOW - 5_000, actionFailures: 0, resolvedByQuery: false, ...over,
});
const plan = (auths: AuthRow[], decision: GroupDecision = null, now = NOW) => planStep({ id: 'g1', decision }, auths, now);

describe('planStep: 沒有任何授權紀錄（SQL 手造的空群組）', () => {
  it.each([null, 'capture', 'abandon'] as const)('決定=%s 時絕不能收尾成已付款，改成失敗（回到可重付）', (d) => {
    expect(plan([], d)).toEqual({ type: 'finalize', outcome: 'failed' });
  });
});

describe('planStep: 尚未決定', () => {
  it('全部 pending → 全部打綠界授權', () => {
    const a = [auth('pending'), auth('pending')];
    expect(plan(a)).toEqual({ type: 'authorize', auths: a });
  });

  it('全部 authorized → 決定請款（AC-E4）', () => {
    expect(plan([auth('authorized'), auth('authorized')])).toEqual({ type: 'decide', decision: 'capture' });
  });

  it('只要有一家 declined → 立刻決定放棄（AC-E5），即使另一家還在 calling', () => {
    expect(plan([auth('authorized'), auth('declined'), auth('calling')])).toEqual({ type: 'decide', decision: 'abandon' });
  });

  it('沒有 declined、有 calling 且還新 → 等（結果還在路上），不重打', () => {
    expect(plan([auth('authorized'), auth('calling')])).toEqual({ type: 'wait', reason: 'in_flight' });
  });

  it('calling 超過 60 秒 → 去查綠界（AC-E6）', () => {
    const stale = auth('calling', { callStartedAt: NOW - 61_000 });
    expect(plan([auth('authorized'), stale])).toEqual({ type: 'refresh', auths: [stale] });
  });
});

describe('planStep: 決定請款', () => {
  it('authorized 的逐筆關帳', () => {
    const a = [auth('authorized'), auth('captured')];
    expect(plan(a, 'capture')).toEqual({ type: 'capture', auths: [a[0]] });
  });

  it('全部 captured → 收尾成已付款', () => {
    expect(plan([auth('captured'), auth('captured')], 'capture')).toEqual({ type: 'finalize', outcome: 'paid' });
  });

  it('某筆關帳失敗達上限 → 改決定放棄（不能一家請款一家沒請款，K-32）', () => {
    expect(plan([auth('captured'), auth('authorized', { actionFailures: 3 })], 'capture')).toEqual({ type: 'decide', decision: 'abandon' });
  });

  it('關帳空窗（台灣 20:15）→ 等，不打 DoAction', () => {
    const t = Date.UTC(2026, 9, 19, 12, 15, 0); // UTC 12:15 = 台灣 20:15
    expect(plan([auth('authorized')], 'capture', t)).toEqual({ type: 'wait', reason: 'blackout' });
  });
});

describe('planStep: 決定放棄', () => {
  it('從沒打過的 pending 直接標成放棄', () => {
    const p = auth('pending');
    expect(plan([auth('declined'), p], 'abandon')).toEqual({ type: 'skip', auths: [p] });
  });

  it('authorized 與 captured 都要放棄', () => {
    const a = [auth('authorized'), auth('captured'), auth('declined')];
    expect(plan(a, 'abandon')).toEqual({ type: 'abandon', auths: [a[0], a[1]] });
  });

  it('還有 calling 的先解決（它可能已授權），新的 calling 就等', () => {
    expect(plan([auth('declined'), auth('calling')], 'abandon')).toEqual({ type: 'wait', reason: 'in_flight' });
  });

  it('舊的 calling 去查', () => {
    const stale = auth('calling', { callStartedAt: NOW - 120_000 });
    expect(plan([auth('declined'), stale], 'abandon')).toEqual({ type: 'refresh', auths: [stale] });
  });

  it('全部 declined/abandoned → 收尾成失敗', () => {
    expect(plan([auth('declined'), auth('abandoned')], 'abandon')).toEqual({ type: 'finalize', outcome: 'failed' });
  });

  it('放棄動作失敗達上限 → 卡住，絕不收尾（避免留下活的授權）', () => {
    expect(plan([auth('authorized', { actionFailures: 3 })], 'abandon')).toEqual({ type: 'wait', reason: 'stuck' });
  });

  it('放棄動作在關帳空窗 → 等', () => {
    const t = Date.UTC(2026, 9, 19, 12, 20, 0);
    expect(plan([auth('authorized')], 'abandon', t)).toEqual({ type: 'wait', reason: 'blackout' });
  });
});

describe('isDoActionBlackout（台灣時間 20:10–20:35）', () => {
  const tw = (h: number, m: number) => Date.UTC(2026, 9, 19, h - 8, m, 0);
  it.each([[20, 9, false], [20, 10, true], [20, 15, true], [20, 34, true], [20, 35, false], [12, 0, false]])('%i:%i → %s', (h, m, exp) => {
    expect(isDoActionBlackout(tw(h, m))).toBe(exp);
  });
});
