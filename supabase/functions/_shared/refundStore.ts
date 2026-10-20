// deno-lint-ignore-file no-explicit-any
// RefundStore 的 Supabase 實作（service role）。寫入都走資料庫函式（20261020130000_refunds.sql 的 refund_*）。
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import type { RefundJob, RefundStore } from './refundRunner.ts';

export function createRefundStore(db: SupabaseClient): RefundStore {
  return {
    async listDue(limit) {
      const { data, error } = await db.rpc('refund_list_due', { p_limit: limit });
      if (error) throw new Error('refund_list_due: ' + error.message);
      return (data as string[]) ?? [];
    },
    async claim(refundId, leaseSeconds): Promise<RefundJob | null> {
      const { data, error } = await db.rpc('refund_claim', { p_refund: refundId, p_lease_seconds: leaseSeconds });
      if (error) throw new Error('refund_claim: ' + error.message);
      const d = data as any;
      if (!d) return null;
      return { refundId: d.refundId, orderId: d.orderId, merchantId: d.merchantId, merchantTradeNo: d.merchantTradeNo, amount: d.amount,
        attempts: d.attempts, clockFromMs: Date.parse(d.clockFrom) };
    },
    async record(refundId, rec) {
      const { error } = await db.rpc('refund_record', { p_refund: refundId, p_rec: rec });
      if (error) throw new Error('refund_record: ' + error.message);
    },
  };
}
