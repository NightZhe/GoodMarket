// 撥款對帳的執行器（spec-payout-reconcile.md §7；工單 PR-B3）。只管流程：取工作 → 下載 → 解析 → 分段送進資料庫 → 記結果與重試。
// 「這一列對到哪張訂單、算哪一類」全部在資料庫（payout_ingest／payout_classify，§5），同一套規則給排程、人工重抓、人工匯入共用。
// 冪等：每一列有指紋（＝這一列是哪一筆交易＋同檔第幾次出現）與內容雜湊（全部欄位）。資料庫以指紋找同一列：
// 內容相同＝duplicate；內容不同（綠界之後補上撥款日、更正手續費）＝updated，更新那一列（小q BUG-1／BUG-2）。中途失敗再跑一次，結果跟只跑一次相同（AC-R13）。
// 任何失敗都不動既有的撥款資料（§7.2）：失敗只會讓這次匯入少寫，不會刪或改已寫入的列。
import { parsePayoutFile, type InvalidRow, type PayoutRow } from './payoutFile.ts';
import { classifyEcpayMessage, type DownloadRequest, type DownloadResult } from './payoutClient.ts';

export type RowClass = 'matched' | 'updated' | 'duplicate' | 'foreign' | 'unmatched' | 'not_captured' | 'bind_auth' | 'key_conflict' | 'amount_mismatch' | 'invalid';
export type ImportCounts = Partial<Record<RowClass | 'ordersChanged', number>>;
export type ErrorCode = 'ECPAY_UNAVAILABLE' | 'RATE_LIMITED' | 'ECPAY_DENIED' | 'PARSE_HEADER' | 'PARSE_ENCODING' | 'INTERNAL';
export type Trigger = 'schedule' | 'manual_fetch' | 'manual_file';

export interface PayoutJob { id: string; merchantId: string; dateType: 'settle' | 'payout'; from: string; to: string; attempts: number }
export type TickClaim = { state: 'job'; job: PayoutJob } | { state: 'disabled' | 'halted' | 'idle' } | { state: 'wait'; retryAfterSeconds: number };
/** fp＝指紋（同一列的身分）；ch＝內容雜湊（任何欄位變了就不同） */
export type IngestRow = ({ kind: 'row' } & PayoutRow & { fp: string; ch: string }) | ({ kind: 'invalid' } & InvalidRow & { fp: string; ch: string });

export interface ImportMeta { trigger: Trigger; merchantId: string; dateType: 'settle' | 'payout' | null; from: string | null; to: string | null; jobId: string | null }
export interface ImportFinish {
  result: 'ok' | 'empty' | 'failed'; errorCode: ErrorCode | null; errorDetail: string | null;
  fileBytes: number | null; fileSha256: string | null; encoding: string | null; totalRows: number | null; counts: ImportCounts;
}
export interface JobFinish { importId: string | null; status: 'done' | 'queued' | 'failed'; attempts: number; nextAttemptAt: number | null; halt: { code: ErrorCode; message: string } | null }

/** 資料庫那一側（實作 payoutStore.ts，service role 呼叫 payout_* 函式）。每個方法一個交易 */
export interface PayoutStore {
  /** 排程用：開關、停機、頻率（距上次呼叫綠界 ≥ 60 秒）都在資料庫裡一次判斷；拿到工作的同時就佔走這一分鐘的呼叫額度 */
  tickClaim(leaseSeconds: number): Promise<TickClaim>;
  /** 人工重抓用：佔呼叫額度（跟排程共用同一個時間戳） */
  reserveCall(): Promise<{ ok: true } | { ok: false; retryAfterSeconds: number }>;
  beginImport(meta: ImportMeta): Promise<string>;
  /** 分類並寫入一段；回這一段的計數（含 ordersChanged） */
  ingest(importId: string, merchantId: string, rows: IngestRow[]): Promise<ImportCounts>;
  /** 只分類不寫入（dryRun） */
  classify(merchantId: string, rows: IngestRow[]): Promise<ImportCounts>;
  finishImport(importId: string, f: ImportFinish): Promise<void>;
  finishJob(jobId: string, f: JobFinish): Promise<void>;
}
export interface Gateway { download(q: DownloadRequest): Promise<DownloadResult> }
export interface RunnerDeps { store: PayoutStore; gateway: Gateway; now: () => number; sleep?: (ms: number) => Promise<void> }

export const INGEST_CHUNK = 500;
export const JOB_LEASE_SECONDS = 300;
export const MAX_ATTEMPTS = 3;
export const RETRY_AFTER_MS = 10 * 60_000;
export const RATE_RETRY_MS = 60_000;
/** pg_cron 每分鐘觸發，但資料庫要求間隔 61 秒（payout_tick_claim），加上觸發時間會飄：差 ≤ 這幾秒就等一下再取，不跳過這一分鐘 */
export const TICK_MAX_WAIT_SECONDS = 15;

const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
const sha256 = async (bytes: Uint8Array) => hex(await crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>));

/** 列指紋（§6.3，小q BUG-1 修正後）：特約商店編號＋「這一列是哪一筆交易」（特店交易編號、綠界交易編號、交易時間、結算日、交易金額）＋同檔第幾次出現。
 *  撥款日、手續費、淨額等綠界之後才補或更正的欄位不在指紋裡（那些變了算同一列「更新」，見 contentHash）。壞列沒有可信的欄位 → 用全部原始欄位 */
export async function fingerprint(merchantId: string, row: PayoutRow | InvalidRow): Promise<string> {
  const canon = 'reason' in row
    ? JSON.stringify([merchantId, 'invalid', Object.keys(row.cells).sort().map((k) => [k, row.cells[k]]), row.occurrence])
    : JSON.stringify([merchantId, row.merchantTradeNo, row.ecpayTradeNo, row.tradeAt, row.settleDate, row.amount, row.occurrence]);
  return sha256(new TextEncoder().encode(canon));
}

/** 內容雜湊：這一列所有保留欄位（行號以外）。指紋相同、內容雜湊不同＝綠界改了這一列 */
export async function contentHash(row: PayoutRow | InvalidRow): Promise<string> {
  const { line: _line, ...rest } = row as PayoutRow & InvalidRow;
  return sha256(new TextEncoder().encode(JSON.stringify(Object.keys(rest).sort().map((k) => [k, (rest as Record<string, unknown>)[k]]))));
}

const add = (a: ImportCounts, b: ImportCounts): ImportCounts => {
  const out = { ...a };
  for (const [k, v] of Object.entries(b)) out[k as keyof ImportCounts] = (out[k as keyof ImportCounts] ?? 0) + (v ?? 0);
  return out;
};

type Processed =
  | { ok: true; result: 'ok' | 'empty'; encoding: string; totalRows: number; counts: ImportCounts; fileBytes: number; fileSha256: string }
  | { ok: false; code: ErrorCode; message: string; fileBytes: number | null; fileSha256: string | null; encoding: string | null };

/** 解析＋（dryRun 時）分類或（否則）分段寫入。importId 為 null＝dryRun */
async function process(store: PayoutStore, merchantId: string, bytes: Uint8Array, importId: string | null): Promise<Processed> {
  const fileSha256 = await sha256(bytes), fileBytes = bytes.length;
  const p = parsePayoutFile(bytes);
  if (!p.ok) {
    const code: ErrorCode = p.code === 'ECPAY_MESSAGE' ? classifyEcpayMessage(p.message) : p.code;
    return { ok: false, code, message: p.message.slice(0, 200), fileBytes, fileSha256, encoding: p.code === 'ECPAY_MESSAGE' ? p.encoding : null };
  }
  const rows: IngestRow[] = [
    ...(await Promise.all(p.rows.map(async (r) => ({ kind: 'row' as const, ...r, fp: await fingerprint(merchantId, r), ch: await contentHash(r) })))),
    ...(await Promise.all(p.invalid.map(async (r) => ({ kind: 'invalid' as const, ...r, fp: await fingerprint(merchantId, r), ch: await contentHash(r) })))),
  ].sort((a, b) => a.line - b.line);
  let counts: ImportCounts = {};
  try {
    for (let i = 0; i < rows.length; i += INGEST_CHUNK) {
      const chunk = rows.slice(i, i + INGEST_CHUNK);
      counts = add(counts, importId ? await store.ingest(importId, merchantId, chunk) : await store.classify(merchantId, chunk));
    }
  } catch (e) {
    console.error('[payout] ingest error', e instanceof Error ? `${e.name}: ${e.message}` : 'unknown');
    return { ok: false, code: 'INTERNAL', message: 'database write failed', fileBytes, fileSha256, encoding: p.encoding };
  }
  return { ok: true, result: p.totalRows === 0 ? 'empty' : 'ok', encoding: p.encoding, totalRows: p.totalRows, counts, fileBytes, fileSha256 };
}

const finishOf = (r: Processed): ImportFinish => r.ok
  ? { result: r.result, errorCode: null, errorDetail: null, fileBytes: r.fileBytes, fileSha256: r.fileSha256, encoding: r.encoding, totalRows: r.totalRows, counts: r.counts }
  : { result: 'failed', errorCode: r.code, errorDetail: r.message, fileBytes: r.fileBytes, fileSha256: r.fileSha256, encoding: r.encoding, totalRows: null, counts: {} };

/** 下載＋處理；下載失敗也回 Processed（ok:false），讓呼叫端統一記錄 */
async function fetchAndProcess(deps: RunnerDeps, q: DownloadRequest, importId: string | null): Promise<Processed> {
  let d: DownloadResult;
  try { d = await deps.gateway.download(q); } catch (e) {
    console.error('[payout] download error', e instanceof Error ? `${e.name}: ${e.message}` : 'unknown');
    return { ok: false, code: 'INTERNAL', message: 'download failed', fileBytes: null, fileSha256: null, encoding: null };
  }
  if (d.kind === 'error') return { ok: false, code: d.code, message: d.message, fileBytes: null, fileSha256: null, encoding: null };
  return process(deps.store, q.merchantId, d.bytes, importId);
}

/** §7.2 的重試規則：綠界不能用／我們自己出錯 → 10 分鐘後再試，最多 3 次；頻率限制 → 下一分鐘、不算次數；
 *  表頭／編碼壞了 → 不重試（同一個檔重抓還是一樣）；ECPAY_DENIED → 不重試且全部停 */
export function jobFinish(job: PayoutJob, r: Processed, importId: string | null, now: number): JobFinish {
  if (r.ok) return { importId, status: 'done', attempts: job.attempts, nextAttemptAt: null, halt: null };
  switch (r.code) {
    case 'RATE_LIMITED': return { importId, status: 'queued', attempts: job.attempts, nextAttemptAt: now + RATE_RETRY_MS, halt: null };
    case 'ECPAY_DENIED': return { importId, status: 'failed', attempts: job.attempts + 1, nextAttemptAt: null, halt: { code: r.code, message: r.message } };
    case 'PARSE_HEADER': case 'PARSE_ENCODING': return { importId, status: 'failed', attempts: job.attempts + 1, nextAttemptAt: null, halt: null };
    default: {
      const attempts = job.attempts + 1;
      return attempts >= MAX_ATTEMPTS ? { importId, status: 'failed', attempts, nextAttemptAt: null, halt: null }
        : { importId, status: 'queued', attempts, nextAttemptAt: now + RETRY_AFTER_MS, halt: null };
    }
  }
}

export type TickReport = { state: 'disabled' | 'halted' | 'idle' } | { state: 'wait'; retryAfterSeconds: number }
  | { state: 'job'; jobId: string; merchantId: string; importId: string; result: 'ok' | 'empty' | 'failed'; errorCode: ErrorCode | null; counts: ImportCounts };

export async function runTick(deps: RunnerDeps): Promise<TickReport> {
  let c = await deps.store.tickClaim(JOB_LEASE_SECONDS);
  if (c.state === 'wait' && c.retryAfterSeconds <= TICK_MAX_WAIT_SECONDS) {
    await (deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms))))(c.retryAfterSeconds * 1000);
    c = await deps.store.tickClaim(JOB_LEASE_SECONDS);
  }
  if (c.state !== 'job') return c;
  const job = c.job;
  const importId = await deps.store.beginImport({ trigger: 'schedule', merchantId: job.merchantId, dateType: job.dateType, from: job.from, to: job.to, jobId: job.id });
  const r = await fetchAndProcess(deps, { merchantId: job.merchantId, dateType: job.dateType, from: job.from, to: job.to }, importId);
  const f = finishOf(r);
  await deps.store.finishImport(importId, f);
  await deps.store.finishJob(job.id, jobFinish(job, r, importId, deps.now()));
  return { state: 'job', jobId: job.id, merchantId: job.merchantId, importId, result: f.result, errorCode: f.errorCode, counts: f.counts };
}

export type ManualResult =
  | { ok: true; dryRun: boolean; importId: string | null; result: 'ok' | 'empty' | 'failed'; errorCode: ErrorCode | null; errorDetail: string | null;
      encoding: string | null; totalRows: number | null; fileBytes: number | null; fileSha256: string | null; counts: ImportCounts }
  | { ok: false; code: 'RATE_LIMITED'; message: string; retryAfter: number };

const manualOut = (dryRun: boolean, importId: string | null, f: ImportFinish): ManualResult =>
  ({ ok: true, dryRun, importId, result: f.result, errorCode: f.errorCode, errorDetail: f.errorDetail, encoding: f.encoding, totalRows: f.totalRows,
     fileBytes: f.fileBytes, fileSha256: f.fileSha256, counts: f.counts });

/** 人工重抓某家店、某段日期（≤ 1 個月，呼叫端先驗）。dryRun：照樣呼叫綠界（佔呼叫額度），只分類計數，不開匯入紀錄、不寫入 */
export async function manualFetch(deps: RunnerDeps, q: DownloadRequest & { dryRun: boolean }): Promise<ManualResult> {
  const slot = await deps.store.reserveCall();
  if (!slot.ok) return { ok: false, code: 'RATE_LIMITED', message: `綠界限制一分鐘下載一個檔，請 ${slot.retryAfterSeconds} 秒後再試`, retryAfter: slot.retryAfterSeconds };
  const req = { merchantId: q.merchantId, dateType: q.dateType, from: q.from, to: q.to };
  const importId = q.dryRun ? null : await deps.store.beginImport({ trigger: 'manual_fetch', ...req, jobId: null });
  const f = finishOf(await fetchAndProcess(deps, req, importId));
  if (importId) await deps.store.finishImport(importId, f);
  return manualOut(q.dryRun, importId, f);
}

/** 人工匯入從綠界後台下載的檔（D45／D46 的退路）。格式要跟 35670 相同（U-R5 未查證） */
export async function importBytes(deps: Omit<RunnerDeps, 'gateway'>, a: { merchantId: string; bytes: Uint8Array; trigger: 'manual_file'; dryRun: boolean }): Promise<ManualResult> {
  const importId = a.dryRun ? null : await deps.store.beginImport({ trigger: a.trigger, merchantId: a.merchantId, dateType: null, from: null, to: null, jobId: null });
  const f = finishOf(await process(deps.store, a.merchantId, a.bytes, importId));
  if (importId) await deps.store.finishImport(importId, f);
  return manualOut(a.dryRun, importId, f);
}
