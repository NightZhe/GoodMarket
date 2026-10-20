import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fingerprint, importBytes, INGEST_CHUNK, manualFetch, runTick, type ImportCounts, type IngestRow, type PayoutJob, type PayoutStore, type TickClaim } from './payoutRunner.ts';
import type { DownloadRequest, DownloadResult } from './payoutClient.ts';
import { parsePayoutFile } from './payoutFile.ts';

const fx = (name: string) => new Uint8Array(readFileSync(new URL(`./fixtures/payout/${name}`, import.meta.url)));
const T0 = Date.UTC(2026, 9, 21, 7, 10); // 台灣 15:10

interface Imp { id: string; meta: Record<string, unknown>; finish?: Record<string, unknown>; chunks: number }
/** 記憶體版 store：只模擬 runner 看得到的行為（排隊、租約、停機旗標、匯入紀錄）。分類本身在資料庫（SQL 測試），這裡回「每列都 matched」 */
function memoryStore(jobs: Partial<PayoutJob>[], opts: { disabled?: boolean; failIngestAtChunk?: number } = {}) {
  const queue = jobs.map((j, i) => ({ id: `J${i + 1}`, merchantId: `39990${i + 1}`, dateType: 'settle' as const, from: '2026-10-07', to: '2026-10-21', attempts: 0,
    status: 'queued', nextAttemptAt: T0, ...j }));
  const imports: Imp[] = [];
  const state = { halted: null as null | { code: string; message: string }, ingestCalls: 0, classifyCalls: 0 };
  const finished: Record<string, unknown>[] = [];
  const store: PayoutStore = {
    async tickClaim(): Promise<TickClaim> {
      if (opts.disabled) return { state: 'disabled' };
      if (state.halted) return { state: 'halted' };
      const j = queue.find((q) => q.status === 'queued' && q.nextAttemptAt <= T0);
      if (!j) return { state: 'idle' };
      j.status = 'running';
      return { state: 'job', job: { id: j.id, merchantId: j.merchantId, dateType: j.dateType, from: j.from, to: j.to, attempts: j.attempts } };
    },
    async reserveCall() { return { ok: true }; },
    async beginImport(meta) { const id = `I${imports.length + 1}`; imports.push({ id, meta, chunks: 0 }); return id; },
    async ingest(importId, _m, rows) {
      state.ingestCalls++;
      const imp = imports.find((i) => i.id === importId)!;
      imp.chunks++;
      if (opts.failIngestAtChunk === imp.chunks) throw new Error('db down');
      return { matched: rows.filter((r) => r.kind === 'row').length, invalid: rows.filter((r) => r.kind === 'invalid').length };
    },
    async classify(_m, rows) { state.classifyCalls++; return { matched: rows.filter((r) => r.kind === 'row').length, invalid: rows.filter((r) => r.kind === 'invalid').length }; },
    async finishImport(importId, f) { imports.find((i) => i.id === importId)!.finish = f as unknown as Record<string, unknown>; },
    async finishJob(jobId, o) {
      finished.push({ jobId, ...o });
      const j = queue.find((q) => q.id === jobId)!;
      j.status = o.status; if (o.nextAttemptAt) j.nextAttemptAt = o.nextAttemptAt; j.attempts = o.attempts;
      if (o.halt) state.halted = o.halt;
    },
  };
  return { store, queue, imports, state, finished };
}
function gateway(byMerchant: Record<string, DownloadResult | 'throw'>) {
  const calls: DownloadRequest[] = [];
  return { calls, g: { async download(q: DownloadRequest): Promise<DownloadResult> { calls.push(q); const r = byMerchant[q.merchantId] ?? { kind: 'file', bytes: fx('header-only.csv') }; if (r === 'throw') throw new Error('boom'); return r; } } };
}
const file = (name: string): DownloadResult => ({ kind: 'file', bytes: fx(name) });

describe('fingerprint（§6.3）', () => {
  it('同一列內容＝同指紋（行號不算）；同檔第 2 次出現、不同特約商店 → 不同指紋', async () => {
    const r = parsePayoutFile(fx('partial-refunds.csv'));
    if (!r.ok) throw new Error('parse');
    const [pos, ref1, ref2] = r.rows;
    expect(await fingerprint('3999001', pos)).toBe(await fingerprint('3999001', { ...pos, line: 99 }));
    expect(await fingerprint('3999001', ref1)).not.toBe(await fingerprint('3999001', ref2));
    expect(await fingerprint('3999001', pos)).not.toBe(await fingerprint('3999002', pos));
    expect(await fingerprint('3999001', pos)).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('runTick：排程每分鐘一件', () => {
  it('正常檔 → 開一筆匯入紀錄（schedule）、送進資料庫分類寫入、匯入 ok、工作完成', async () => {
    const m = memoryStore([{}]); const gw = gateway({ '399901': file('ac-r6.csv') });
    const r = await runTick({ store: m.store, gateway: gw.g, now: () => T0 });
    expect(r).toMatchObject({ state: 'job', jobId: 'J1', result: 'ok' });
    expect(gw.calls).toEqual([{ merchantId: '399901', dateType: 'settle', from: '2026-10-07', to: '2026-10-21' }]);
    expect(m.imports[0].meta).toMatchObject({ trigger: 'schedule', merchantId: '399901', jobId: 'J1' });
    expect(m.imports[0].finish).toMatchObject({ result: 'ok', errorCode: null, totalRows: 9, encoding: 'utf-8', fileBytes: fx('ac-r6.csv').length,
      counts: { matched: 8, invalid: 1 } });
    expect(String(m.imports[0].finish!.fileSha256)).toMatch(/^[0-9a-f]{64}$/);
    expect(m.finished[0]).toMatchObject({ jobId: 'J1', status: 'done', attempts: 0, halt: null });
  });
  it('只有表頭 → result empty（算成功：會更新最近成功匯入時間，AC-R17）', async () => {
    const m = memoryStore([{}]);
    expect(await runTick({ store: m.store, gateway: gateway({}).g, now: () => T0 })).toMatchObject({ result: 'empty' });
    expect(m.imports[0].finish).toMatchObject({ result: 'empty', totalRows: 0 });
    expect(m.finished[0]).toMatchObject({ status: 'done' });
  });
  it('AC-R15：5 家店，第 2 家綠界不能用、第 4 家表頭壞 → 其餘 3 家照常；2 號 10 分鐘後重試、4 號不重試；匯入紀錄各一筆正確代碼', async () => {
    const m = memoryStore([{}, {}, {}, {}, {}]);
    const gw = gateway({ '399902': { kind: 'error', code: 'ECPAY_UNAVAILABLE', message: 'http 502' }, '399904': file('missing-required.csv'), '399901': file('ac-r6.csv'), '399903': file('ac-r6.csv'), '399905': file('ac-r6.csv') });
    const results = [];
    for (let i = 0; i < 5; i++) results.push(await runTick({ store: m.store, gateway: gw.g, now: () => T0 }));
    expect(results.map((r) => r.state === 'job' && r.result)).toEqual(['ok', 'failed', 'ok', 'failed', 'ok']);
    expect(m.imports.map((i) => [i.meta.merchantId, i.finish!.result, i.finish!.errorCode])).toEqual([
      ['399901', 'ok', null], ['399902', 'failed', 'ECPAY_UNAVAILABLE'], ['399903', 'ok', null], ['399904', 'failed', 'PARSE_HEADER'], ['399905', 'ok', null]]);
    expect(m.imports[3].chunks).toBe(0); // 表頭壞：一列都沒送進資料庫
    expect(m.finished[1]).toMatchObject({ status: 'queued', attempts: 1, nextAttemptAt: T0 + 10 * 60_000 });
    expect(m.finished[3]).toMatchObject({ status: 'failed', attempts: 1 });
  });
  it('綠界不能用第 3 次 → 今天放棄（failed），明天的範圍會重疊涵蓋', async () => {
    const m = memoryStore([{ attempts: 2 }]);
    await runTick({ store: m.store, gateway: gateway({ '399901': { kind: 'error', code: 'ECPAY_UNAVAILABLE', message: 'timeout' } }).g, now: () => T0 });
    expect(m.finished[0]).toMatchObject({ status: 'failed', attempts: 3 });
  });
  it('AC-R16：第 1 家 ECPAY_DENIED → 停機旗標；之後的 tick 都不再呼叫綠界', async () => {
    const m = memoryStore([{}, {}, {}]);
    const gw = gateway({ '399901': file('ecpay-error-merchant-mismatch.csv') });
    expect(await runTick({ store: m.store, gateway: gw.g, now: () => T0 })).toMatchObject({ result: 'failed', errorCode: 'ECPAY_DENIED' });
    expect(m.finished[0]).toMatchObject({ status: 'failed', halt: { code: 'ECPAY_DENIED', message: 'MerchantID does not match the MerchantID in the encrypted data' } });
    expect(m.imports[0].finish).toMatchObject({ errorCode: 'ECPAY_DENIED', errorDetail: 'MerchantID does not match the MerchantID in the encrypted data' });
    expect(await runTick({ store: m.store, gateway: gw.g, now: () => T0 })).toEqual({ state: 'halted' });
    expect(gw.calls).toHaveLength(1);
  });
  it('頻率限制 → 不算失敗次數，下一分鐘再排', async () => {
    const m = memoryStore([{ attempts: 1 }]);
    await runTick({ store: m.store, gateway: gateway({ '399901': { kind: 'error', code: 'RATE_LIMITED', message: 'too many' } }).g, now: () => T0 });
    expect(m.finished[0]).toMatchObject({ status: 'queued', attempts: 1, nextAttemptAt: T0 + 60_000 });
  });
  it('編碼無法辨識 → PARSE_ENCODING，不重試', async () => {
    const m = memoryStore([{}]);
    await runTick({ store: m.store, gateway: gateway({ '399901': file('garbage.bin') }).g, now: () => T0 });
    expect(m.imports[0].finish).toMatchObject({ result: 'failed', errorCode: 'PARSE_ENCODING' });
    expect(m.finished[0]).toMatchObject({ status: 'failed' });
  });
  it('寫入資料庫中途出錯（第 2 段）→ 匯入 failed／INTERNAL、算一次失敗、10 分鐘後重試（資料庫靠指紋保證重跑不重複，AC-R13）', async () => {
    const big = new TextEncoder().encode(['特店交易編號,綠界交易編號,撥款日期,交易金額', ...Array.from({ length: INGEST_CHUNK + 10 }, (_, i) => `P${i},T${i},,100`)].join('\n'));
    const m = memoryStore([{}], { failIngestAtChunk: 2 });
    expect(await runTick({ store: m.store, gateway: gateway({ '399901': { kind: 'file', bytes: big } }).g, now: () => T0 })).toMatchObject({ result: 'failed', errorCode: 'INTERNAL' });
    expect(m.imports[0].finish).toMatchObject({ result: 'failed', errorCode: 'INTERNAL' });
    expect(m.finished[0]).toMatchObject({ status: 'queued', attempts: 1, nextAttemptAt: T0 + 10 * 60_000 });
  });
  it('大檔分段寫入：每段最多 INGEST_CHUNK 列，計數加總', async () => {
    const big = new TextEncoder().encode(['特店交易編號,綠界交易編號,撥款日期,交易金額', ...Array.from({ length: INGEST_CHUNK * 2 + 1 }, (_, i) => `P${i},T${i},,100`)].join('\n'));
    const m = memoryStore([{}]);
    await runTick({ store: m.store, gateway: gateway({ '399901': { kind: 'file', bytes: big } }).g, now: () => T0 });
    expect(m.imports[0].chunks).toBe(3);
    expect(m.imports[0].finish).toMatchObject({ counts: { matched: INGEST_CHUNK * 2 + 1 } });
  });
  it('還差幾秒才滿 1 分鐘（pg_cron 每分鐘觸發的時間會飄）→ 等那幾秒再取一次，不白白跳過這一分鐘；差太多就原樣回 wait', async () => {
    const m = memoryStore([{}]); const slept: number[] = [];
    let waits = 1;
    const claim = m.store.tickClaim;
    m.store.tickClaim = async (l) => (waits-- > 0 ? { state: 'wait', retryAfterSeconds: 2 } : claim(l));
    const r = await runTick({ store: m.store, gateway: gateway({}).g, now: () => T0, sleep: async (ms) => { slept.push(ms); } });
    expect(slept).toEqual([2000]);
    expect(r).toMatchObject({ state: 'job', result: 'empty' });
    m.store.tickClaim = async () => ({ state: 'wait', retryAfterSeconds: 40 });
    expect(await runTick({ store: m.store, gateway: gateway({}).g, now: () => T0, sleep: async (ms) => { slept.push(ms); } })).toEqual({ state: 'wait', retryAfterSeconds: 40 });
    expect(slept).toEqual([2000]);
  });
  it('開關關著、停機中、還不到 1 分鐘、沒有工作 → 原樣回報，不呼叫綠界', async () => {
    const gw = gateway({});
    expect(await runTick({ store: memoryStore([{}], { disabled: true }).store, gateway: gw.g, now: () => T0 })).toEqual({ state: 'disabled' });
    expect(await runTick({ store: memoryStore([]).store, gateway: gw.g, now: () => T0 })).toEqual({ state: 'idle' });
    expect(gw.calls).toHaveLength(0);
  });
});

describe('人工補跑', () => {
  it('manualFetch dryRun → 呼叫綠界、只分類計數，不開匯入紀錄、不寫入（AC-R20）', async () => {
    const m = memoryStore([]); const gw = gateway({ '3999001': file('ac-r6.csv') });
    const r = await manualFetch({ store: m.store, gateway: gw.g, now: () => T0 }, { merchantId: '3999001', dateType: 'settle', from: '2026-10-07', to: '2026-10-21', dryRun: true });
    expect(r).toMatchObject({ ok: true, dryRun: true, result: 'ok', totalRows: 9, counts: { matched: 8, invalid: 1 } });
    expect(m.imports).toHaveLength(0);
    expect(m.state.ingestCalls).toBe(0);
  });
  it('manualFetch 還不到 1 分鐘 → RATE_LIMITED＋retryAfter，不呼叫綠界', async () => {
    const m = memoryStore([]); m.store.reserveCall = async () => ({ ok: false, retryAfterSeconds: 42 });
    const gw = gateway({});
    expect(await manualFetch({ store: m.store, gateway: gw.g, now: () => T0 }, { merchantId: '3999001', dateType: 'settle', from: '2026-10-07', to: '2026-10-21', dryRun: false }))
      .toEqual({ ok: false, code: 'RATE_LIMITED', message: expect.any(String), retryAfter: 42 });
    expect(gw.calls).toHaveLength(0);
  });
  it('importBytes（人工匯入檔案）→ trigger manual_file，結果與排程匯入同一份內容相同', async () => {
    const m = memoryStore([]);
    const r = await importBytes({ store: m.store, now: () => T0 }, { merchantId: '3999001', bytes: fx('ac-r6-big5.csv'), trigger: 'manual_file', dryRun: false });
    expect(r).toMatchObject({ ok: true, result: 'ok', encoding: 'big5', totalRows: 9, counts: { matched: 8, invalid: 1 } });
    expect(m.imports[0].meta).toMatchObject({ trigger: 'manual_file', merchantId: '3999001', dateType: null });
  });
});
