// POST { merchantTradeNo } → { ok, status: 'created'|'confirming'|'bound'|'failed', paymentMethodId?, duplicate?, message? }
// 要登入。綁卡結果頁輪詢用；結果不明時伺服器會用綁卡清單反查（35613）。
import { admin, json, PayError, readJson, requireUser, serve } from '../_shared/http.ts';
import { loadConfig } from '../_shared/env.ts';
import { createEcpayClient } from '../_shared/ecpayClient.ts';
import { bindStatus } from '../_shared/bindFlow.ts';

serve('payment-bind-status', async (req) => {
  const user = await requireUser(req);
  const b = await readJson(req);
  if (typeof b.merchantTradeNo !== 'string') throw new PayError('REQUEST_INVALID', '請求格式不正確');
  const cfg = loadConfig();
  return json(req, { ok: true, ...(await bindStatus(admin(), cfg, createEcpayClient(cfg.ecpay), user, b.merchantTradeNo)) });
});
