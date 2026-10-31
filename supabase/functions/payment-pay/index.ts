// POST { groupId, paymentMethodId } → { ok, outcome: 'paid'|'failed'|'confirming', groupId, failure?, reason?, group }
// 要登入。結帳付款：每家店各授權一筆 → 全部成功才逐筆請款；任一失敗全部放棄（D19、D20）。
// 每筆授權都刷進本站自己的商店編號（ECPAY_MERCHANT_ID；PR-乙 IN-B3），不再用各店的特約商店。
// 訂單要先用 RPC place_online_order 建好（取得 payGroupId）。
import { admin, json, readJson, requireUser, serve } from '../_shared/http.ts';
import { loadConfig } from '../_shared/env.ts';
import { createEcpayClient } from '../_shared/ecpayClient.ts';
import { startPay } from '../_shared/payFlow.ts';

serve('payment-pay', async (req) => {
  const user = await requireUser(req);
  const b = await readJson(req);
  const cfg = loadConfig();
  return json(req, { ok: true, ...(await startPay(admin(), createEcpayClient(cfg.ecpay), user, b.groupId, b.paymentMethodId, cfg.ecpay.merchantId)) });
});
