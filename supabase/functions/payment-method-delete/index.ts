// POST { id } → { ok, status: 'deleted'|'revoking' }
// 要登入。刪除綁定的卡（35608）。先在資料庫隱藏（revoking，立刻不能再扣款），再向綠界撤銷；綠界沒回應時留在 revoking，排程重試。
import { admin, json, PayError, readJson, requireUser, serve } from '../_shared/http.ts';
import { loadConfig } from '../_shared/env.ts';
import { createEcpayClient } from '../_shared/ecpayClient.ts';
import { deleteMethod } from '../_shared/bindFlow.ts';
import { isUuid } from '../_shared/payFlow.ts';

serve('payment-method-delete', async (req) => {
  const user = await requireUser(req);
  const b = await readJson(req);
  if (!isUuid(b.id)) throw new PayError('REQUEST_INVALID', '請求格式不正確');
  const cfg = loadConfig();
  return json(req, { ok: true, ...(await deleteMethod(admin(), cfg, createEcpayClient(cfg.ecpay), user, b.id)) });
});
