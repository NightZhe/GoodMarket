// deno-lint-ignore-file no-explicit-any
// PaymentStore 的 Supabase 實作（service role）。每個方法一個原子寫入；跨表的轉換走資料庫函式 pay_*。
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import type { FailureInfo, PaymentStore } from './paymentRunner.ts';
import type { AuthRow, GroupDecision } from './paymentTypes.ts';

const toRow = (r: any): AuthRow => ({
  id: r.id, orderId: r.order_id, shopId: r.shop_id, merchantId: r.merchant_id, merchantTradeNo: r.merchant_trade_no, amount: r.amount,
  state: r.state, ecpayTradeNo: r.ecpay_trade_no, rtnCode: r.rtn_code, rtnMsg: r.rtn_msg,
  callStartedAt: r.call_started_at ? Date.parse(r.call_started_at) : null, actionFailures: r.action_failures, resolvedByQuery: r.resolved_by_query,
});

const COL: Record<string, string> = {
  state: 'state', ecpayTradeNo: 'ecpay_trade_no', rtnCode: 'rtn_code', rtnMsg: 'rtn_msg', actionFailures: 'action_failures', resolvedByQuery: 'resolved_by_query',
};

function check<T>(r: { data: T; error: { message: string } | null }, what: string): T {
  if (r.error) throw new Error(`${what}: ${r.error.message}`);
  return r.data;
}

export function createSupabaseStore(db: SupabaseClient): PaymentStore {
  return {
    async listAuths(groupId) {
      const g = check(await db.from('payment_groups').select('attempt_no').eq('id', groupId).single(), 'group');
      const rows = check(await db.from('payment_auths').select('*').eq('group_id', groupId).eq('attempt_no', (g as any).attempt_no).order('created_at').order('id'), 'auths');
      return (rows as any[]).map(toRow);
    },
    async getDecision(groupId): Promise<GroupDecision> {
      const g = check(await db.from('payment_groups').select('decision').eq('id', groupId).single(), 'decision');
      return (g as any).decision ?? null;
    },
    async setDecision(groupId, d) {
      check(await db.from('payment_groups').update({ decision: d, updated_at: new Date().toISOString() }).eq('id', groupId), 'setDecision');
    },
    async markCalling(authId, nowMs) {
      check(await db.from('payment_auths').update({ state: 'calling', call_started_at: new Date(nowMs).toISOString(), updated_at: new Date().toISOString() }).eq('id', authId), 'markCalling');
    },
    async saveAuth(authId, patch) {
      const row: Record<string, unknown> = { updated_at: new Date().toISOString() };
      for (const [k, v] of Object.entries(patch)) if (COL[k]) row[COL[k]] = v;
      check(await db.from('payment_auths').update(row).eq('id', authId), 'saveAuth');
    },
    async finalizePaid(groupId) { check(await db.rpc('pay_finalize_paid', { p_group: groupId }), 'finalizePaid'); },
    async finalizeAttemptFailed(groupId, f: FailureInfo) { check(await db.rpc('pay_finalize_failed', { p_group: groupId, p_fail: f }), 'finalizeFailed'); },
    async setConfirming(groupId, reason) { check(await db.rpc('pay_set_confirming', { p_group: groupId, p_reason: reason }), 'setConfirming'); },
  };
}
