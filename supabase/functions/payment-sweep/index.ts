// POST（標頭 x-cron-secret）→ { ok, expiredOrders, resolvedGroups, stillConfirming, autoAccepted, refunded, refundRetry, refundManual, refundErrors,
//                               refundBlackout, voidedBind, revoked, bindSynced }
// 排程用（pg_cron 每分鐘）：待付款逾時作廢並退庫存、補償確認中的付款、取消申請逾時自動同意、已取消訂單的退款（放棄授權／退刷）、
// 放棄綁卡驗證授權、重試撤銷卡片、反查沒收到結果的綁卡。
import { admin, json, PayError, serve } from '../_shared/http.ts';
import { loadConfig } from '../_shared/env.ts';
import { createEcpayClient } from '../_shared/ecpayClient.ts';
import { sweep } from '../_shared/payFlow.ts';

const safeEqual = (a: string, b: string) => {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
};

serve('payment-sweep', async (req) => {
  const cfg = loadConfig();
  const given = req.headers.get('x-cron-secret') ?? '';
  if (!cfg.cronSecret || !safeEqual(given, cfg.cronSecret)) throw new PayError('FORBIDDEN', '沒有權限', 403);
  return json(req, { ok: true, ...(await sweep(admin(), cfg, createEcpayClient(cfg.ecpay))) });
});
