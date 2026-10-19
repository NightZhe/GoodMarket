// POST { merchantTradeNo, bindCardPayToken } → { ok, status: 'bound'|'need3d'|'failed'|'confirming', ... }
// 要登入。前端 SDK 的 getBindCardPayToken 拿到 bindCardPayToken 後呼叫（建立綁卡交易 35596）。
import { admin, json, PayError, readJson, requireUser, serve } from '../_shared/http.ts';
import { loadConfig } from '../_shared/env.ts';
import { createEcpayClient } from '../_shared/ecpayClient.ts';
import { confirmBind } from '../_shared/bindFlow.ts';

serve('payment-bind-confirm', async (req) => {
  const user = await requireUser(req);
  const b = await readJson(req);
  if (typeof b.merchantTradeNo !== 'string' || typeof b.bindCardPayToken !== 'string' || !b.bindCardPayToken || b.bindCardPayToken.length > 100) {
    throw new PayError('REQUEST_INVALID', '請求格式不正確');
  }
  const cfg = loadConfig();
  return json(req, { ok: true, ...(await confirmBind(admin(), cfg, createEcpayClient(cfg.ecpay), user, b.merchantTradeNo, b.bindCardPayToken)) });
});
