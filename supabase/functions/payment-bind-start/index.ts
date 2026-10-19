// POST { returnPath?: string }  → { ok, merchantTradeNo, token, tokenExpiresAt, serverType, sdkUrl }
// 要登入。取得綠界綁卡畫面用的廠商驗證碼（35591）。前端拿 token 呼叫 ECPay.addBindingCard。
import { admin, json, readJson, requireUser, serve } from '../_shared/http.ts';
import { loadConfig } from '../_shared/env.ts';
import { createEcpayClient } from '../_shared/ecpayClient.ts';
import { startBind } from '../_shared/bindFlow.ts';

serve('payment-bind-start', async (req) => {
  const user = await requireUser(req);
  const body = await readJson(req);
  const cfg = loadConfig();
  const r = await startBind(admin(), cfg, createEcpayClient(cfg.ecpay), user, body.returnPath);
  return json(req, { ok: true, ...r });
});
