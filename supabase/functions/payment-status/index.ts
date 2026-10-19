// POST { groupId } → { ok, group: { status, orders[], lastFail, ... } }
// 要登入。「確認中」的輪詢入口：若這個群組卡在確認中，伺服器順手跑一輪補償（查綠界 → 請款或放棄）再回傳最新狀態。
import { admin, json, readJson, requireUser, serve } from '../_shared/http.ts';
import { loadConfig } from '../_shared/env.ts';
import { createEcpayClient } from '../_shared/ecpayClient.ts';
import { paymentStatus } from '../_shared/payFlow.ts';

serve('payment-status', async (req) => {
  const user = await requireUser(req);
  const b = await readJson(req);
  const cfg = loadConfig();
  return json(req, { ok: true, ...(await paymentStatus(admin(), createEcpayClient(cfg.ecpay), user, b.groupId)) });
});
