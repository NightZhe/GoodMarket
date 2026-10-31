// deno-lint-ignore-file no-explicit-any
// 綁卡流程（35586）：bind-start → 前端 SDK 填卡 → bind-confirm（CreateBindCard）→（3D）→ OrderResultURL／ReturnURL → bind-status。
// 卡號從頭到尾不進本站；BindCardID 只存在 payment_methods，只有這裡（service role）讀得到，也不寫進日誌。
// 綁卡掛在本站收款用的商店編號（cfg.ecpay.merchantId）底下，跟授權同一組（PR-乙 IN-B3；舊的 ECPAY_BIND_MERCHANT_ID 不再使用）。
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import type { AppConfig } from './env.ts';
import { bindFromData, twDateTime, type BindResult, type EcpayClient } from './ecpayClient.ts';
import { PayError, type AuthedUser } from './http.ts';

export const SDK_URLS = { Stage: 'https://ecpg-stage.ecpay.com.tw/Scripts/sdk-1.0.0.js?t=20210121100116', Prod: 'https://ecpg.ecpay.com.tw/Scripts/sdk-1.0.0.js?t=20210121100116' } as const;

/** 站內路徑：以單一 / 開頭，不含反斜線與控制字元，長度 200 內（防開放轉址） */
export const isSafeReturnPath = (p: unknown): p is string =>
  typeof p === 'string' && p.length <= 200 && /^\/(?![\/\\])[^\x00-\x1f\\]*$/.test(p);

const BIND_TOKEN_TTL_MS = 35 * 60_000;

export async function startBind(db: SupabaseClient, cfg: AppConfig, ecpay: EcpayClient, user: AuthedUser, returnPath: unknown) {
  if (returnPath != null && !isSafeReturnPath(returnPath)) throw new PayError('RETURN_PATH_INVALID', '回傳路徑不正確');
  const phone = user.phone ? user.phone.replace(/\D/g, '') : '';
  if (!user.email && !phone) throw new PayError('NO_CONTACT', '帳號沒有電子郵件或手機號碼，無法綁卡');
  const { data, error } = await db.rpc('bind_begin', { p_user: user.id, p_return_path: returnPath ?? null });
  if (error) throw new Error('bind_begin: ' + error.message);
  if (!data.ok) throw new PayError(data.code, data.message, data.code === 'CARD_LIMIT' ? 409 : data.code === 'BIND_RATE_LIMIT' ? 429 : 400);

  const t = await ecpay.getBindToken({
    bindMerchantId: cfg.ecpay.merchantId, memberId: data.memberId, email: user.email ?? undefined, phone: phone || undefined,
    merchantTradeNo: data.merchantTradeNo, tradeDate: ecpay.now(), amount: cfg.bindAmount,
    returnUrl: `${cfg.functionsBaseUrl}/payment-bind-return`, orderResultUrl: `${cfg.functionsBaseUrl}/payment-bind-result`,
  });
  if (!t.ok) {
    await db.rpc('bind_apply_failure', { p_trade_no: data.merchantTradeNo, p_rtn_code: null, p_rtn_msg: t.rtnMsg });
    console.error('[bind-start] getBindToken failed', t.kind, t.rtnMsg);
    throw new PayError('BIND_UNAVAILABLE', '目前無法新增信用卡，請稍後再試', 502);
  }
  const env = cfg.ecpay.env === 'prod' ? 'Prod' : 'Stage';
  return { merchantTradeNo: data.merchantTradeNo as string, token: t.token, tokenExpiresAt: t.expiresAt, serverType: env, sdkUrl: SDK_URLS[env] };
}

async function loadAttempt(db: SupabaseClient, merchantTradeNo: string, userId?: string) {
  let q = db.from('ecpay_bind_attempts').select('*').eq('merchant_trade_no', merchantTradeNo);
  if (userId) q = q.eq('user_id', userId);
  const { data, error } = await q.maybeSingle();
  if (error) throw new Error('loadAttempt: ' + error.message);
  return data as any | null;
}

/** 綁卡用的最低金額授權要放棄（35591）；失敗留給 sweep 重試 */
export async function voidBindTransaction(db: SupabaseClient, cfg: AppConfig, ecpay: EcpayClient, merchantTradeNo: string) {
  const r = await ecpay.abandon({ merchantId: cfg.ecpay.merchantId, merchantTradeNo, amount: cfg.bindAmount });
  if (r.kind === 'done') {
    await db.from('ecpay_bind_attempts').update({ void_state: 'done', updated_at: new Date().toISOString() }).eq('merchant_trade_no', merchantTradeNo);
  } else {
    const a = await loadAttempt(db, merchantTradeNo);
    if (a) await db.from('ecpay_bind_attempts').update({ void_failures: (a.void_failures ?? 0) + 1, updated_at: new Date().toISOString() }).eq('id', a.id);
    console.error('[bind] void failed', merchantTradeNo, r.kind);
  }
}

export type BindOutcome =
  | { status: 'bound'; paymentMethodId: string; duplicate: boolean }
  | { status: 'failed'; code: string; message: string };

export async function applyBound(db: SupabaseClient, cfg: AppConfig, ecpay: EcpayClient, b: Extract<BindResult, { kind: 'bound' }>, merchantTradeNo: string): Promise<BindOutcome> {
  const { data, error } = await db.rpc('bind_apply_success', {
    p_trade_no: merchantTradeNo, p_bind_card_id: b.bindCardId, p_card6: b.card6, p_card4: b.card4, p_exp_year: b.expYear, p_exp_month: b.expMonth,
    p_is_same: b.isSameCard, p_ecpay_trade_no: b.tradeNo,
  });
  if (error) throw new Error('bind_apply_success: ' + error.message);
  if (!data.ok) {
    if (data.deleteBindCardId) {
      await ecpay.deleteBindCard({ bindMerchantId: cfg.ecpay.merchantId, bindCardId: data.deleteBindCardId });
      await voidBindTransaction(db, cfg, ecpay, merchantTradeNo);
    }
    return { status: 'failed', code: data.code, message: data.message };
  }
  if (!data.already) await voidBindTransaction(db, cfg, ecpay, merchantTradeNo);
  return { status: 'bound', paymentMethodId: data.paymentMethodId, duplicate: !!data.duplicate };
}

const declineText = (code: number | null) => code === 10100252 ? '這張卡的額度或餘額不足，請換一張卡' : code === 10100255 || code === 10100256 || code === 10100251 ? '這張卡已失效，請換一張卡' : '這張卡綁定沒有成功，請確認卡片資料或換一張卡';

export async function confirmBind(db: SupabaseClient, cfg: AppConfig, ecpay: EcpayClient, user: AuthedUser, merchantTradeNo: string, bindCardPayToken: string) {
  const a = await loadAttempt(db, merchantTradeNo, user.id);
  if (!a) throw new PayError('BIND_NOT_FOUND', '找不到這次綁卡，請重新開始', 404);
  if (a.status === 'bound') return { status: 'bound', paymentMethodId: a.payment_method_id, duplicate: !!a.is_same_card };
  if (a.status === 'failed') return { status: 'failed', code: 'BIND_FAILED', message: declineText(a.rtn_code) };
  await db.from('ecpay_bind_attempts').update({ status: 'confirming', updated_at: new Date().toISOString() }).eq('id', a.id).in('status', ['created', 'confirming']);
  const r = await ecpay.createBindCard({ bindMerchantId: cfg.ecpay.merchantId, memberId: a.merchant_member_id, bindCardPayToken });
  if (r.kind === 'need3d') return { status: 'need3d', url: r.url };
  if (r.kind === 'bound') return applyBound(db, cfg, ecpay, r, merchantTradeNo);
  if (r.kind === 'failed') {
    await db.rpc('bind_apply_failure', { p_trade_no: merchantTradeNo, p_rtn_code: r.rtnCode, p_rtn_msg: r.rtnMsg });
    return { status: 'failed', code: 'BIND_FAILED', message: declineText(r.rtnCode) };
  }
  return { status: 'confirming' }; // 結果不明：前端輪詢 bind-status，伺服器用綁卡清單反查
}

/** ReturnURL（背景）與 OrderResultURL（瀏覽器）共用：Data 已通過解密 */
export async function handleBindNotification(db: SupabaseClient, cfg: AppConfig, ecpay: EcpayClient, data: Record<string, any>) {
  const merchantTradeNo = String(data.OrderInfo?.MerchantTradeNo ?? '');
  const a = merchantTradeNo ? await loadAttempt(db, merchantTradeNo) : null;
  if (!a) return { attempt: null, outcome: { status: 'failed', code: 'BIND_NOT_FOUND', message: '找不到這次綁卡' } as BindOutcome };
  // 防張冠李戴：通知裡的會員編號必須是這次嘗試的會員
  if (data.MerchantMemberID && data.MerchantMemberID !== a.merchant_member_id) {
    return { attempt: a, outcome: { status: 'failed', code: 'BIND_NOT_FOUND', message: '找不到這次綁卡' } as BindOutcome };
  }
  const b = bindFromData(data);
  if (b.kind === 'bound') return { attempt: a, outcome: await applyBound(db, cfg, ecpay, b, merchantTradeNo) };
  const code = b.kind === 'failed' ? b.rtnCode : null;
  await db.rpc('bind_apply_failure', { p_trade_no: merchantTradeNo, p_rtn_code: code, p_rtn_msg: b.kind === 'failed' ? b.rtnMsg : '' });
  return { attempt: a, outcome: { status: 'failed', code: 'BIND_FAILED', message: declineText(code) } as BindOutcome };
}

/** 用綁卡清單反查（ReturnURL 沒收到、結果不明時）。回 true＝有進展 */
export async function syncBindByQuery(db: SupabaseClient, cfg: AppConfig, ecpay: EcpayClient, a: any): Promise<boolean> {
  const q = await ecpay.queryBindCards({ bindMerchantId: cfg.ecpay.merchantId, memberId: a.merchant_member_id, merchantTradeNo: a.merchant_trade_no });
  if (!q.ok) return false;
  const { data: known } = await db.from('payment_methods').select('bind_card_id').eq('user_id', a.user_id);
  const have = new Set((known ?? []).map((r: any) => r.bind_card_id));
  const fresh = q.cards.find((c) => !have.has(c.bindCardId));
  if (fresh) {
    await applyBound(db, cfg, ecpay, { kind: 'bound', bindCardId: fresh.bindCardId, isSameCard: false, card6: fresh.card6, card4: fresh.card4, expYear: fresh.expYear, expMonth: fresh.expMonth, tradeNo: '', merchantTradeNo: a.merchant_trade_no }, a.merchant_trade_no);
    return true;
  }
  if (Date.now() - Date.parse(a.created_at) > BIND_TOKEN_TTL_MS) {
    await db.rpc('bind_apply_failure', { p_trade_no: a.merchant_trade_no, p_rtn_code: null, p_rtn_msg: 'no card found after token expiry' });
    return true;
  }
  return false;
}

export async function bindStatus(db: SupabaseClient, cfg: AppConfig, ecpay: EcpayClient, user: AuthedUser, merchantTradeNo: string) {
  let a = await loadAttempt(db, merchantTradeNo, user.id);
  if (!a) throw new PayError('BIND_NOT_FOUND', '找不到這次綁卡', 404);
  if ((a.status === 'created' || a.status === 'confirming') && Date.now() - Date.parse(a.updated_at) > 15_000) {
    if (await syncBindByQuery(db, cfg, ecpay, a)) a = await loadAttempt(db, merchantTradeNo, user.id);
  }
  if (a.status === 'bound') return { status: 'bound', paymentMethodId: a.payment_method_id, duplicate: !!a.is_same_card };
  if (a.status === 'failed') return { status: 'failed', code: 'BIND_FAILED', message: declineText(a.rtn_code) };
  return { status: a.status as 'created' | 'confirming' };
}

export async function deleteMethod(db: SupabaseClient, cfg: AppConfig, ecpay: EcpayClient, user: AuthedUser, id: string) {
  const { data, error } = await db.rpc('method_begin_delete', { p_user: user.id, p_id: id });
  if (error) throw new Error('method_begin_delete: ' + error.message);
  if (!data.ok) throw new PayError(data.code, data.message, data.code === 'CARD_NOT_FOUND' ? 404 : 409);
  return finishDelete(db, cfg, ecpay, id, data.bindCardId);
}

export async function finishDelete(db: SupabaseClient, cfg: AppConfig, ecpay: EcpayClient, id: string, bindCardId: string) {
  const r = await ecpay.deleteBindCard({ bindMerchantId: cfg.ecpay.merchantId, bindCardId });
  if (r.kind === 'done') {
    await db.rpc('method_finish_delete', { p_id: id });
    return { status: 'deleted' as const };
  }
  const { data: m } = await db.from('payment_methods').select('revoke_failures').eq('id', id).maybeSingle();
  await db.from('payment_methods').update({ revoke_failures: ((m as any)?.revoke_failures ?? 0) + 1, updated_at: new Date().toISOString() }).eq('id', id);
  console.error('[method-delete] ecpay delete not confirmed', r.kind);
  return { status: 'revoking' as const }; // 已隱藏、不能扣款；sweep 會重試
}

export { twDateTime };
