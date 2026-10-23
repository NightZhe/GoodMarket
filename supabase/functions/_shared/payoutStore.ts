// deno-lint-ignore-file no-explicit-any
// PayoutStore 的 Supabase 實作（service role）。全部走資料庫函式 payout_*（20261020140000_payout_reconcile.sql）。
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import type { PayoutStore, TickClaim } from './payoutRunner.ts';

async function call<T>(db: SupabaseClient, fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await db.rpc(fn, args);
  if (error) throw new Error(`${fn}: ${error.message}`);
  return data as T;
}

export function createPayoutStore(db: SupabaseClient): PayoutStore {
  return {
    tickClaim: (lease) => call<TickClaim>(db, 'payout_tick_claim', { p_lease_seconds: lease }),
    reserveCall: () => call(db, 'payout_reserve_call', {}),
    beginImport: (m) => call<string>(db, 'payout_import_begin', { p_trigger: m.trigger, p_merchant: m.merchantId, p_date_type: m.dateType, p_from: m.from, p_to: m.to, p_job: m.jobId }),
    ingest: (importId, _merchantId, rows) => call(db, 'payout_ingest', { p_import: importId, p_rows: rows }),
    classify: (merchantId, rows) => call(db, 'payout_classify', { p_merchant: merchantId, p_rows: rows }),
    async finishImport(importId, f) { await call(db, 'payout_import_finish', { p_import: importId, p_finish: f }); },
    async finishJob(jobId, f) {
      await call(db, 'payout_job_finish', { p_job: jobId, p_finish: { ...f, nextAttemptAt: f.nextAttemptAt == null ? null : new Date(f.nextAttemptAt).toISOString() } });
    },
  };
}

/** 排程與人工補跑用的其他資料庫呼叫（不在 runner 的介面裡） */
export const enqueueDaily = (db: SupabaseClient) => call<{ state: string; enqueued: number }>(db, 'payout_enqueue_daily', {});
export const enqueueBackfill = (db: SupabaseClient, segments: { from: string; to: string }[], merchantId: string | null) =>
  call<{ state: string; enqueued: number }>(db, 'payout_enqueue_backfill', { p_segments: segments, p_merchant: merchantId });
