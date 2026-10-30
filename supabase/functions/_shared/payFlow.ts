// deno-lint-ignore-file no-explicit-any
// 結帳付款與補償（payment-pay / payment-status / payment-sweep / payment-pay-return）。狀態機在 paymentPlanner／paymentRunner。
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import type { AppConfig } from './env.ts';
import type { EcpayClient } from './ecpayClient.ts';
import { driveGroup, type DriveResult } from './paymentRunner.ts';
import { createSupabaseStore } from './supabaseStore.ts';
import { asUser, PayError, type AuthedUser } from './http.ts';
import { finishDelete, syncBindByQuery, voidBindTransaction } from './bindFlow.ts';
import { sweepRefunds } from './refundRunner.ts';
import { createRefundStore } from './refundStore.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: unknown): v is string => typeof v === 'string' && UUID.test(v);

const STATUS_FOR: Record<string, number> = { GROUP_NOT_FOUND: 404, CARD_NOT_FOUND: 404, ALREADY_PAID: 409, PAYMENT_IN_PROGRESS: 409, ORDER_EXPIRED: 410, PAYMENT_DISABLED: 503 };

const drive = (db: SupabaseClient, ecpay: EcpayClient) => ({ store: createSupabaseStore(db), gateway: ecpay, now: Date.now });

async function safeDrive(db: SupabaseClient, ecpay: EcpayClient, groupId: string, opts: Parameters<typeof driveGroup>[2]): Promise<DriveResult> {
  try {
    return await driveGroup(drive(db, ecpay), groupId, opts);
  } catch (e) {
    console.error('[pay] drive error', e instanceof Error ? `${e.name}: ${e.message}` : 'unknown');
    await db.rpc('pay_set_confirming', { p_group: groupId, p_reason: 'error' });
    return { outcome: 'confirming', reason: 'error' };
  }
}

export async function groupView(user: AuthedUser, groupId: string) {
  const { data, error } = await asUser(user.jwt).rpc('get_payment_group', { p_group: groupId });
  if (error) throw new PayError(error.hint || 'GROUP_NOT_FOUND', error.message, 404);
  return data;
}

/** collectMerchantId：本站收款用的商店編號（cfg.ecpay.merchantId）。每筆授權都刷進它並快照到 payment_auths.merchant_id（PR-乙 IN-B3／S-2）。 */
export async function startPay(db: SupabaseClient, ecpay: EcpayClient, user: AuthedUser, groupId: unknown, paymentMethodId: unknown, collectMerchantId: string) {
  if (!isUuid(groupId) || !isUuid(paymentMethodId)) throw new PayError('REQUEST_INVALID', '請求格式不正確');
  const { data, error } = await db.rpc('pay_begin_attempt', { p_group: groupId, p_user: user.id, p_method: paymentMethodId, p_collect_merchant_id: collectMerchantId });
  if (error) throw new Error('pay_begin_attempt: ' + error.message);
  if (!data.ok) throw new PayError(data.code, data.message, STATUS_FOR[data.code] ?? 400);

  const result = await safeDrive(db, ecpay, groupId, {
    allowAuthorize: true,
    authorizeCtx: { bindCardId: data.bindCardId, memberId: data.memberId, buyerEmail: user.email ?? undefined, itemName: '好物集訂單', tradeDate: ecpay.now() },
  });
  return { ...result, groupId, group: await groupView(user, groupId) };
}

/** 補償：搶到租約才處理（避免跟還活著的請求或另一個補償撞在一起）。回 null＝沒搶到 */
export async function resolveGroup(db: SupabaseClient, ecpay: EcpayClient, groupId: string, userId: string | null): Promise<DriveResult | null> {
  const { data: claimed, error } = await db.rpc('pay_claim_for_resolve', { p_group: groupId, p_user: userId });
  if (error) throw new Error('pay_claim_for_resolve: ' + error.message);
  if (!claimed) return null;
  return safeDrive(db, ecpay, groupId, { allowAuthorize: false });
}

/** 前端輪詢：順手把自己的「確認中」群組解決掉 */
export async function paymentStatus(db: SupabaseClient, ecpay: EcpayClient, user: AuthedUser, groupId: unknown) {
  if (!isUuid(groupId)) throw new PayError('REQUEST_INVALID', '請求格式不正確');
  let view = await groupView(user, groupId);
  if (view.status === 'confirming' || view.status === 'processing') {
    if (await resolveGroup(db, ecpay, groupId, user.id)) view = await groupView(user, groupId);
  }
  return { group: view };
}

/** 綠界付款結果背景通知（ReturnURL）：只用來把 calling 的授權推進成 authorized，其餘交給補償。 */
export async function handlePayNotification(db: SupabaseClient, data: Record<string, any>) {
  const no = String(data.OrderInfo?.MerchantTradeNo ?? '');
  if (!no || data.SimulatePaid === 1 || data.SimulatePaid === '1') return; // 模擬付款不是真交易（2856）
  if (data.RtnCode !== 1) return;
  await db.from('payment_auths').update({ state: 'authorized', ecpay_trade_no: String(data.OrderInfo?.TradeNo ?? ''), rtn_code: 1, updated_at: new Date().toISOString() })
    .eq('merchant_trade_no', no).eq('state', 'calling');
}

/** 排程（pg_cron 每分鐘，或手動）：逾時作廢、補償確認中的付款、取消申請逾時自動同意與退款（spec-refund.md）、
 *  放棄綁卡驗證授權、重試撤銷卡片、反查沒收到結果的綁卡。退款不看功能開關（R-RF9：關開關只停新的線上付款）。 */
export async function sweep(db: SupabaseClient, cfg: AppConfig, ecpay: EcpayClient) {
  const deadline = Date.now() + 100_000;
  const out = { expiredOrders: 0, resolvedGroups: 0, stillConfirming: 0, autoAccepted: 0, refunded: 0, refundRetry: 0, refundManual: 0, refundErrors: 0,
    refundBlackout: false, voidedBind: 0, revoked: 0, bindSynced: 0 };

  const ex = await db.rpc('expire_pending_online_orders', { p_limit: 200 });
  if (ex.error) throw new Error('expire: ' + ex.error.message);
  out.expiredOrders = ex.data as number;

  const ids = await db.rpc('pay_list_resolvable', { p_limit: 50 });
  if (ids.error) throw new Error('list: ' + ids.error.message);
  for (const id of (ids.data as string[]) ?? []) {
    if (Date.now() > deadline) break;
    const r = await resolveGroup(db, ecpay, id, null);
    if (r) { if (r.outcome === 'confirming') out.stillConfirming++; else out.resolvedGroups++; }
  }

  // 取消申請逾時 48 小時 → 自動同意（D27＝A），訂單變已取消＋退款處理中；接著同一輪就跑退款
  const aa = await db.rpc('refund_auto_accept_due', { p_limit: 100 });
  if (aa.error) throw new Error('auto-accept: ' + aa.error.message);
  out.autoAccepted = aa.data as number;
  const rf = await sweepRefunds({ store: createRefundStore(db), gateway: ecpay, now: Date.now }, { limit: 50, deadlineMs: deadline });
  out.refunded = rf.refunded; out.refundRetry = rf.retry; out.refundManual = rf.manual; out.refundErrors = rf.errors; out.refundBlackout = rf.blackout;

  const { data: voids } = await db.from('ecpay_bind_attempts').select('merchant_trade_no').eq('void_state', 'pending').lt('void_failures', 20).limit(50);
  for (const v of (voids ?? []) as any[]) {
    if (Date.now() > deadline) break;
    await voidBindTransaction(db, cfg, ecpay, v.merchant_trade_no); out.voidedBind++;
  }

  const { data: revoking } = await db.from('payment_methods').select('id, bind_card_id').eq('status', 'revoking').lt('revoke_failures', 20).limit(50);
  for (const m of (revoking ?? []) as any[]) {
    if (Date.now() > deadline) break;
    const r = await finishDelete(db, cfg, ecpay, m.id, m.bind_card_id); if (r.status === 'deleted') out.revoked++;
  }

  const cutoff = new Date(Date.now() - 3 * 60_000).toISOString();
  const { data: open } = await db.from('ecpay_bind_attempts').select('*').in('status', ['created', 'confirming']).lt('updated_at', cutoff).limit(50);
  for (const a of (open ?? []) as any[]) {
    if (Date.now() > deadline) break;
    if (await syncBindByQuery(db, cfg, ecpay, a)) out.bindSynced++;
  }
  return out;
}
