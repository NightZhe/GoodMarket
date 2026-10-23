// 退款執行器（.work/account-payment-methods/spec-refund.md §6.2、§10.1；工單 RF-B2）。
// 訂單在資料庫裡變成「已取消＋退款處理中」時已經寫好一筆退款紀錄（order_refunds）；這裡負責把它對綠界做完。
// 一筆退款：搶租約（同一筆同時只有一個執行器）→ ecpayClient.refund（依綠界狀態選 N／E＋N／R，前後讀關帳明細）→ 把結果寫回。
// 冪等：資料庫保證每張訂單最多一筆退款紀錄；綠界那一側靠「動作前先查」——已取消／已退刷就直接記完成，不再發動作。
// 不沿用付款流程的「3 次就卡住」：E 在系統自動關帳的授權隔日 6:00 前會被拒（35642），要一直重試，
// 從進入退款處理中（或維運按重試）滿 36 小時仍沒完成，或綠界明確回覆餘額不足／商店停用，才標記需要人工（R-RF11、H-RF5）。
import type { RefundResult } from './ecpayClient.ts';
import { isDoActionBlackout } from './paymentPlanner.ts';

export interface RefundJob {
  refundId: string;
  orderId: string;
  merchantId: string;
  merchantTradeNo: string;
  amount: number;
  /** 之前已經失敗／不明幾次 */
  attempts: number;
  /** 36 小時從哪一刻開始算：進入退款處理中的時間，維運按過重試則是那一刻（毫秒） */
  clockFromMs: number;
}

export type RefundRecord =
  | { outcome: 'done'; method: 'void' | 'card_refund'; action: string; ecpayStatus: string | null }
  | { outcome: 'failed' | 'unknown'; action: string; rtnCode: number | null; rtnMsg: string; ecpayStatus: string | null;
      needsManual: boolean; manualHint: 'balance' | 'other' | null; nextAttemptAt: number };

/** 資料庫那一側（實作：refundStore.ts，service role 呼叫 refund_* 函式）。每個方法一個原子寫入。 */
export interface RefundStore {
  /** 該跑的退款：處理中、沒標人工、到了下次嘗試時間、沒有人持有租約 */
  listDue(limit: number): Promise<string[]>;
  /** 搶租約；搶不到（別人在跑、已完成、已標人工）回 null */
  claim(refundId: string, leaseSeconds: number): Promise<RefundJob | null>;
  /** 寫回這次的結果並放掉租約；done 時同一個交易把訂單改成已退款 */
  record(refundId: string, rec: RefundRecord): Promise<void>;
}

export interface RefundGateway { refund(ref: { merchantId: string; merchantTradeNo: string; amount: number }): Promise<RefundResult> }
export interface RefundDeps { store: RefundStore; gateway: RefundGateway; now: () => number }

export const REFUND_MANUAL_AFTER_MS = 36 * 3600_000;
export const REFUND_LEASE_SECONDS = 120;

/** 第 n 次失敗後隔多久再試：1、2、4、8、16 分鐘，之後每 30 分鐘（36 小時內約 75 次，不每分鐘打綠界） */
export const retryDelayMs = (attempts: number) => Math.min(60_000 * 2 ** Math.max(0, attempts - 1), 30 * 60_000);

export type RefundOutcome = 'refunded' | 'retry' | 'manual' | 'skipped';

export async function processRefund(deps: RefundDeps, refundId: string): Promise<RefundOutcome> {
  const { store, gateway, now } = deps;
  const job = await store.claim(refundId, REFUND_LEASE_SECONDS);
  if (!job) return 'skipped';
  const r = await gateway.refund({ merchantId: job.merchantId, merchantTradeNo: job.merchantTradeNo, amount: job.amount });
  if (r.kind === 'done') {
    await store.record(refundId, { outcome: 'done', method: r.method, action: r.ecpayStatus === 'none' ? 'query' : r.method === 'card_refund' ? 'R' : 'N', ecpayStatus: r.ecpayStatus });
    return 'refunded';
  }
  const attempts = job.attempts + 1;
  const manualHint = r.kind === 'failed' && r.hint === 'balance' ? 'balance' : r.kind === 'failed' && r.hint === 'stop' ? 'other' : null;
  const needsManual = manualHint !== null || now() - job.clockFromMs >= REFUND_MANUAL_AFTER_MS;
  await store.record(refundId, {
    outcome: r.kind, action: r.action,
    rtnCode: r.kind === 'failed' ? r.rtnCode : null, rtnMsg: r.kind === 'failed' ? r.rtnMsg : r.reason, ecpayStatus: r.kind === 'failed' ? r.ecpayStatus : null,
    needsManual, manualHint: needsManual ? manualHint ?? 'other' : null, nextAttemptAt: now() + retryDelayMs(attempts),
  });
  return needsManual ? 'manual' : 'retry';
}

export interface RefundSweepReport { blackout: boolean; refunded: number; retry: number; manual: number; skipped: number; errors: number }

/** 排程一輪：關帳空窗（台灣 20:10–20:35，C-14）整輪不碰綠界；否則逐筆處理到期限為止。單筆出錯只記數、不中斷（錯誤細節進日誌，不含卡號與金鑰） */
export async function sweepRefunds(deps: RefundDeps, opts: { limit: number; deadlineMs: number }): Promise<RefundSweepReport> {
  const out: RefundSweepReport = { blackout: false, refunded: 0, retry: 0, manual: 0, skipped: 0, errors: 0 };
  if (isDoActionBlackout(deps.now())) { out.blackout = true; return out; }
  for (const id of await deps.store.listDue(opts.limit)) {
    if (deps.now() > opts.deadlineMs || isDoActionBlackout(deps.now())) break;
    try {
      out[await processRefund(deps, id)]++;
    } catch (e) {
      out.errors++;
      console.error('[refund] error', id, e instanceof Error ? `${e.name}: ${e.message}` : 'unknown');
    }
  }
  return out;
}
