// 綠界 OrderResultURL（35606）：3D 驗證後，買家的瀏覽器被綠界 form POST 到這裡（ResultData=...）。
// 處理結果後 303 導回前端：<siteUrl>/#<returnPath>?bind=<bound|failed|confirming>&no=<merchantTradeNo>
// 重要：Supabase Edge Function 對 text/html 會改成 text/plain，所以這裡只回轉址，不回頁面。
import { admin } from '../_shared/http.ts';
import { loadConfig } from '../_shared/env.ts';
import { createEcpayClient } from '../_shared/ecpayClient.ts';
import { parseResultData } from '../_shared/ecpayCrypto.ts';
import { handleBindNotification, isSafeReturnPath } from '../_shared/bindFlow.ts';

const DEFAULT_PATH = '/account/payment-methods';

Deno.serve(async (req) => {
  const cfg = loadConfig();
  const go = (path: string, status: string, no: string) =>
    new Response(null, { status: 303, headers: { Location: `${cfg.siteUrl}/#${path}?bind=${status}&no=${encodeURIComponent(no)}` } });
  if (req.method !== 'POST') return go(DEFAULT_PATH, 'failed', '');
  try {
    const p = await parseResultData<Record<string, any>>(await req.text(), cfg.ecpay.hashKey, cfg.ecpay.hashIv);
    if (!p.ok) return go(DEFAULT_PATH, 'failed', '');
    const { attempt, outcome } = await handleBindNotification(admin(), cfg, createEcpayClient(cfg.ecpay), p.data);
    const path = attempt && isSafeReturnPath(attempt.return_path) ? attempt.return_path : DEFAULT_PATH;
    return go(path, outcome.status, String(p.data.OrderInfo?.MerchantTradeNo ?? ''));
  } catch (e) {
    console.error('[payment-bind-result]', e instanceof Error ? e.name : 'unknown');
    return go(DEFAULT_PATH, 'confirming', '');
  }
});
