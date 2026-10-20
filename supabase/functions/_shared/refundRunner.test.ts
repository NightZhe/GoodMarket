import { describe, expect, it } from 'vitest';
import { processRefund, sweepRefunds, REFUND_MANUAL_AFTER_MS, type RefundJob, type RefundRecord, type RefundStore } from './refundRunner.ts';
import type { RefundResult } from './ecpayClient.ts';

// 台灣 2026-10-21 10:00（UTC 02:00）：不在 20:10–20:35 關帳空窗
const T0 = Date.UTC(2026, 9, 21, 2, 0, 0);
const BLACKOUT = Date.UTC(2026, 9, 21, 12, 15, 0); // 台灣 20:15

interface Row extends RefundJob { status: 'refunding' | 'refunded'; leaseUntil: number | null; nextAttemptAt: number; needsManual: boolean; records: RefundRecord[] }

/** 記憶體版的 RefundStore：claim 用租約保證同一筆同時只有一個執行器在動（跟資料庫的 refund_claim 同一個語意） */
function memoryRefunds(rows: Partial<Row>[], clock: { now: number }) {
  const map = new Map<string, Row>(rows.map((r, i) => {
    const row: Row = { refundId: `R${i + 1}`, orderId: `O${i + 1}`, merchantId: '3002607', merchantTradeNo: `P${i + 1}`, amount: 120, attempts: 0,
      clockFromMs: clock.now, status: 'refunding', leaseUntil: null, nextAttemptAt: clock.now, needsManual: false, records: [], ...r };
    return [row.refundId, row];
  }));
  const store: RefundStore = {
    async listDue(limit) {
      return [...map.values()].filter((r) => r.status === 'refunding' && !r.needsManual && r.nextAttemptAt <= clock.now && (r.leaseUntil == null || r.leaseUntil < clock.now))
        .slice(0, limit).map((r) => r.refundId);
    },
    async claim(id, leaseSeconds) {
      const r = map.get(id);
      if (!r || r.status !== 'refunding' || r.needsManual || r.nextAttemptAt > clock.now || (r.leaseUntil != null && r.leaseUntil >= clock.now)) return null;
      r.leaseUntil = clock.now + leaseSeconds * 1000;
      const { refundId, orderId, merchantId, merchantTradeNo, amount, attempts, clockFromMs } = r;
      return { refundId, orderId, merchantId, merchantTradeNo, amount, attempts, clockFromMs };
    },
    async record(id, rec) {
      const r = map.get(id)!;
      r.records.push(rec); r.leaseUntil = null;
      if (rec.outcome === 'done') { r.status = 'refunded'; return; }
      r.attempts += 1; r.nextAttemptAt = rec.nextAttemptAt; if (rec.needsManual) r.needsManual = true;
    },
  };
  return { store, map };
}

function gateway(results: (RefundResult | (() => Promise<RefundResult>))[]) {
  const calls: string[] = [];
  return {
    calls,
    g: { async refund(a: { merchantTradeNo: string }) { calls.push(a.merchantTradeNo); const r = results.shift() ?? { kind: 'unknown', action: 'query', reason: 'x' } as RefundResult; return typeof r === 'function' ? r() : r; } },
  };
}
const VOID: RefundResult = { kind: 'done', method: 'void', ecpayStatus: 'cancelled' };
const E_REJECTED: RefundResult = { kind: 'failed', action: 'E', rtnCode: 10000002, rtnMsg: 'error', ecpayStatus: 'to_capture', hint: null };

describe('processRefund（一筆退款：先搶租約 → 打綠界 → 記結果）', () => {
  it('綠界完成 → 記成已退款，方式照綠界實際做的（取消授權）', async () => {
    const clock = { now: T0 }; const { store, map } = memoryRefunds([{}], clock); const gw = gateway([VOID]);
    expect(await processRefund({ store, gateway: gw.g, now: () => clock.now }, 'R1')).toBe('refunded');
    expect(map.get('R1')!.status).toBe('refunded');
    expect(map.get('R1')!.records[0]).toMatchObject({ outcome: 'done', method: 'void' });
    expect(gw.calls).toEqual(['P1']);
  });
  it('E 被拒（隔日 6:00 前）→ 維持處理中、排下次重試，不是人工；間隔 1、2、4… 分鐘，最多 30 分鐘（AC-RF18）', async () => {
    const clock = { now: T0 }; const { store, map } = memoryRefunds([{}], clock);
    const gw = gateway(Array.from({ length: 8 }, () => E_REJECTED));
    const deps = { store, gateway: gw.g, now: () => clock.now };
    const gaps: number[] = [];
    for (let i = 0; i < 8; i++) {
      expect(await processRefund(deps, 'R1')).toBe('retry');
      gaps.push((map.get('R1')!.nextAttemptAt - clock.now) / 60_000);
      clock.now = map.get('R1')!.nextAttemptAt;
    }
    expect(gaps).toEqual([1, 2, 4, 8, 16, 30, 30, 30]);
    const rec = map.get('R1')!.records[0];
    expect(rec).toMatchObject({ outcome: 'failed', action: 'E', rtnCode: 10000002, ecpayStatus: 'to_capture', needsManual: false, manualHint: null });
    expect(map.get('R1')!.status).toBe('refunding');
  });
  it('結果不明（逾時）也是重試，不是失敗', async () => {
    const clock = { now: T0 }; const { store, map } = memoryRefunds([{}], clock);
    const gw = gateway([{ kind: 'unknown', action: 'R', reason: 'timeout' }]);
    expect(await processRefund({ store, gateway: gw.g, now: () => clock.now }, 'R1')).toBe('retry');
    expect(map.get('R1')!.records[0]).toMatchObject({ outcome: 'unknown', action: 'R', rtnMsg: 'timeout', needsManual: false });
  });
  it('從進入退款處理中滿 36 小時仍沒完成 → 標記需要人工（other），之後排程不再自動跑（AC-RF21）', async () => {
    const clock = { now: T0 }; const { store, map } = memoryRefunds([{ clockFromMs: T0 - REFUND_MANUAL_AFTER_MS + 60_000 }], clock);
    const gw = gateway([E_REJECTED, E_REJECTED]);
    const deps = { store, gateway: gw.g, now: () => clock.now };
    expect(await processRefund(deps, 'R1')).toBe('retry');      // 35 小時 59 分：還不到
    clock.now = map.get('R1')!.nextAttemptAt;                     // 剛好滿 36 小時
    expect(await processRefund(deps, 'R1')).toBe('manual');
    expect(map.get('R1')!.records[1]).toMatchObject({ needsManual: true, manualHint: 'other' });
    clock.now += 3600_000;
    expect(await store.listDue(10)).toEqual([]);
    expect(await processRefund(deps, 'R1')).toBe('skipped');
    expect(gw.calls).toHaveLength(2);
  });
  it('維運按重試（36 小時從那一刻重算）→ 又可以自動跑', async () => {
    const clock = { now: T0 }; const { store } = memoryRefunds([{ clockFromMs: T0 - 60_000, attempts: 500 }], clock);
    const gw = gateway([E_REJECTED]);
    expect(await processRefund({ store, gateway: gw.g, now: () => clock.now }, 'R1')).toBe('retry');
  });
  it('綠界明確回覆餘額不足 → 馬上標記需要人工，hint＝balance（AC-RF20）', async () => {
    const clock = { now: T0 }; const { store, map } = memoryRefunds([{}], clock);
    const gw = gateway([{ kind: 'failed', action: 'R', rtnCode: 10000099, rtnMsg: '帳戶餘額不足', ecpayStatus: 'captured', hint: 'balance' }]);
    expect(await processRefund({ store, gateway: gw.g, now: () => clock.now }, 'R1')).toBe('manual');
    expect(map.get('R1')!.records[0]).toMatchObject({ outcome: 'failed', needsManual: true, manualHint: 'balance', rtnMsg: '帳戶餘額不足' });
  });
  it('查無商家或商家已到期（error_Stop）→ 馬上標記需要人工，hint＝other', async () => {
    const clock = { now: T0 }; const { store, map } = memoryRefunds([{}], clock);
    const gw = gateway([{ kind: 'failed', action: 'query', rtnCode: null, rtnMsg: 'error_Stop', ecpayStatus: null, hint: 'stop' }]);
    expect(await processRefund({ store, gateway: gw.g, now: () => clock.now }, 'R1')).toBe('manual');
    expect(map.get('R1')!.records[0]).toMatchObject({ needsManual: true, manualHint: 'other' });
  });
});

describe('sweepRefunds（排程每分鐘，併入 payment-sweep）', () => {
  it('跑完所有該跑的退款，回報件數', async () => {
    const clock = { now: T0 }; const { store, map } = memoryRefunds([{}, {}, { nextAttemptAt: T0 + 60_000 }], clock);
    const gw = gateway([VOID, E_REJECTED]);
    expect(await sweepRefunds({ store, gateway: gw.g, now: () => clock.now }, { limit: 50, deadlineMs: T0 + 100_000 }))
      .toEqual({ blackout: false, refunded: 1, retry: 1, manual: 0, skipped: 0, errors: 0 });
    expect(gw.calls).toEqual(['P1', 'P2']);          // R3 還沒到下次嘗試時間
    expect(map.get('R1')!.status).toBe('refunded');
  });
  it('台灣 20:10–20:35 空窗：完全不呼叫綠界，退款維持處理中，空窗後下一輪完成（AC-RF19）', async () => {
    const clock = { now: BLACKOUT }; const { store, map } = memoryRefunds([{}], clock); const gw = gateway([VOID]);
    const deps = { store, gateway: gw.g, now: () => clock.now };
    expect(await sweepRefunds(deps, { limit: 50, deadlineMs: BLACKOUT + 100_000 })).toMatchObject({ blackout: true, refunded: 0 });
    expect(gw.calls).toEqual([]); expect(map.get('R1')!.status).toBe('refunding'); expect(map.get('R1')!.attempts).toBe(0);
    clock.now = Date.UTC(2026, 9, 21, 12, 35, 0);   // 台灣 20:35
    expect(await sweepRefunds(deps, { limit: 50, deadlineMs: clock.now + 100_000 })).toMatchObject({ blackout: false, refunded: 1 });
  });
  it('兩個執行器同時跑（排程重疊）→ 每筆退款只打一次綠界（AC-RF11）', async () => {
    const clock = { now: T0 }; const { store, map } = memoryRefunds([{}, {}], clock);
    let release!: () => void; const gate = new Promise<void>((r) => { release = r; });
    const slow = () => gate.then(() => VOID);
    const gw = gateway([slow, slow, slow, slow]);
    const deps = { store, gateway: gw.g, now: () => clock.now };
    const a = sweepRefunds(deps, { limit: 50, deadlineMs: T0 + 100_000 });
    const b = sweepRefunds(deps, { limit: 50, deadlineMs: T0 + 100_000 });
    await new Promise((r) => setTimeout(r, 10)); release();
    const [ra, rb] = await Promise.all([a, b]);
    expect(gw.calls.sort()).toEqual(['P1', 'P2']);
    expect(ra.refunded + rb.refunded).toBe(2);
    expect([...map.values()].every((r) => r.status === 'refunded' && r.records.length === 1)).toBe(true);
  });
  it('單筆出錯（資料庫寫入失敗）不影響其他筆，件數記在 errors', async () => {
    const clock = { now: T0 }; const { store } = memoryRefunds([{}, {}], clock);
    const broken: RefundStore = { ...store, async record(id, rec) { if (id === 'R1') throw new Error('db down'); return store.record(id, rec); } };
    const gw = gateway([VOID, VOID]);
    expect(await sweepRefunds({ store: broken, gateway: gw.g, now: () => clock.now }, { limit: 50, deadlineMs: T0 + 100_000 }))
      .toMatchObject({ refunded: 1, errors: 1 });
  });
  it('超過期限就停，剩下的留給下一輪', async () => {
    const clock = { now: T0 }; const { store } = memoryRefunds([{}, {}], clock);
    const gw = gateway([async () => { clock.now += 200_000; return VOID; }, VOID]);
    expect(await sweepRefunds({ store, gateway: gw.g, now: () => clock.now }, { limit: 50, deadlineMs: T0 + 100_000 })).toMatchObject({ refunded: 1 });
    expect(gw.calls).toEqual(['P1']);
  });
});
