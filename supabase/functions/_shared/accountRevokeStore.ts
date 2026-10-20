// deno-lint-ignore-file no-explicit-any
// RevokeStore 的 Supabase 實作（service role）。寫入都走資料庫函式（20261020120000_account_delete_cards.sql）。
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import type { BeginResult, RevokeStore } from './accountRevoke.ts';

export function createRevokeStore(db: SupabaseClient): RevokeStore {
  return {
    async begin(userId): Promise<BeginResult> {
      const { data, error } = await db.rpc('admin_revoke_account_begin', { p_user: userId });
      if (error) throw new Error('admin_revoke_account_begin: ' + error.message);
      const d = data as any;
      if (!d.ok) return { ok: false, code: d.code, message: d.message, retryAfter: d.retryAfter ?? null };
      return { ok: true, memberId: d.memberId ?? null, cards: d.cards };
    },
    async finishDelete(methodId) {
      const { error } = await db.rpc('method_finish_delete', { p_id: methodId });
      if (error) throw new Error('method_finish_delete: ' + error.message);
    },
    async recordFailure(methodId) {
      const { error } = await db.rpc('method_revoke_failed', { p_id: methodId });
      if (error) throw new Error('method_revoke_failed: ' + error.message);
    },
    async countMethods(userId) {
      const { count, error } = await db.from('payment_methods').select('id', { count: 'exact', head: true }).eq('user_id', userId);
      if (error) throw new Error('count payment_methods: ' + error.message);
      return count ?? 0;
    },
  };
}
