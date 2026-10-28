// POST { bankCode, branchCode, account, holder, setPayout? } → { ok:true, id, limit, accounts:[…] }
// 要登入。新增銀行帳號（掛人、最多 5 筆、不可修改；契約 .work/seller-bank-account/interface-bank-account-v2.md §3.2）。
//   · 第一筆不需簡訊；已有 ≥1 筆時要 JWT 的 amr 有 10 分鐘內的 otp（資料庫 _add_bank_account 是最後一道）。
//   · 帳號用 AES-256-GCM 加密後才進資料庫；密文與金鑰版本一起存；另算全站唯一的 fingerprint（T2）。
//   · 以 --no-verify-jwt 部署：函式自己 auth.getUser(token)，才能回統一格式的 401。
//   · 完整帳號（原始或正規化後）不得寫進 log、錯誤訊息或回應。這裡的 console.error 只寫固定字串與錯誤碼。
// Secrets：BANK_ACCOUNT_KEY（base64 的 32 bytes）、BANK_ACCOUNT_KEY_VERSION（整數，預設 1）；
//          SUPABASE_URL／SUPABASE_ANON_KEY／SUPABASE_SERVICE_ROLE_KEY 由平台提供；PAYMENT_ALLOWED_ORIGINS（選用，同付款函式）。
// 不用 _shared/http.ts：它的 CORS 會載入整套綠界設定，而本函式不需要綠界的 secret。
import { createClient } from 'npm:@supabase/supabase-js@2';
import { BankError, encryptAccount, fingerprintAccount, latestOtpAt, mapDbError, parseAddBody, parseKeyConfig } from '../_shared/bankAccount.ts';

const cors = (req: Request): Record<string, string> => {
  const origin = req.headers.get('origin') ?? '';
  const allowed = (Deno.env.get('PAYMENT_ALLOWED_ORIGINS') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const allow = allowed.length === 0 ? '*' : allowed.includes(origin) ? origin : allowed[0];
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
  };
};
const reply = (req: Request, body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors(req), 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(req) });
  try {
    if (req.method !== 'POST') throw new BankError('METHOD_NOT_ALLOWED', '不支援的請求', 405);

    const jwt = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
    if (!jwt) throw new BankError('NOT_AUTHENTICATED', '請先登入', 401);
    const url = Deno.env.get('SUPABASE_URL'), anon = Deno.env.get('SUPABASE_ANON_KEY'), svc = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!url || !anon || !svc) throw new Error('missing platform env');
    const { data, error } = await createClient(url, anon, { auth: { persistSession: false } }).auth.getUser(jwt);
    if (error || !data.user) throw new BankError('NOT_AUTHENTICATED', '登入已過期，請重新登入', 401);

    let body: unknown;
    try { body = await req.json(); } catch { throw new BankError('REQUEST_INVALID', '請求格式不正確'); }
    const input = parseAddBody(body);
    const keyCfg = parseKeyConfig(Deno.env.get('BANK_ACCOUNT_KEY'), Deno.env.get('BANK_ACCOUNT_KEY_VERSION'));

    const cipher = await encryptAccount(keyCfg.key, input.account);
    const fingerprint = await fingerprintAccount(keyCfg.key, input.bankCode, input.account);
    const admin = createClient(url, svc, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: list, error: rpcErr } = await admin.rpc('_add_bank_account', {
      p_user: data.user.id,
      p_bank_code: input.bankCode,
      p_branch_code: input.branchCode,
      p_cipher: cipher,
      p_key_version: keyCfg.version,
      p_fingerprint: fingerprint,
      p_last4: input.account.slice(-4),
      p_holder: input.holder,
      p_set_payout: input.setPayout,
      p_otp_at: latestOtpAt(jwt),
    });
    if (rpcErr) {
      const mapped = mapDbError(rpcErr.hint);   // hint＝錯誤碼；message 是中文，不採用也不寫 log
      if (mapped.code === 'INTERNAL') console.error('[bank-account-add] rpc failed', rpcErr.code ?? 'unknown'); // 不寫 message
      throw mapped;
    }
    return reply(req, { ok: true, ...(list as Record<string, unknown>) });
  } catch (e) {
    if (e instanceof BankError) return reply(req, { ok: false, error: { code: e.code, message: e.message } }, e.status);
    console.error('[bank-account-add] unexpected', e instanceof Error ? e.name : 'unknown'); // 不寫 message
    return reply(req, { ok: false, error: { code: 'INTERNAL', message: '系統忙碌，請稍後再試' } }, 500);
  }
});
