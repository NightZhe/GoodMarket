// POST（標頭 x-admin-secret）{ userId } → { ok:true, userId, checkedAt, hasMember, allRevoked, queryOk, ecpayRemaining, siteRemaining, cards[], orphans[], queryError }
// 刪帳號流程專用（.work/buyer-auth/prod-runbook.md 第 6 節；spec-account-delete-cards.md）：把這個帳號在綠界的綁卡全部刪掉，
// 並以綠界的會員綁卡清單反查到 0 張。不是給前端的；只有維運人員在自己的終端機用管理密碼（PAYMENT_ADMIN_SECRET）呼叫。
// 錯誤：403 FORBIDDEN（密碼不對／沒設／跟排程密碼相同）、400 REQUEST_INVALID、404 USER_NOT_FOUND、
//       409 PAYMENT_IN_PROGRESS／BIND_IN_PROGRESS（error.retryAfter＝預估可重試時間）、500 INTERNAL。
// 回應與日誌不含 BindCardID、會員代號、金鑰（R-8）。HTTP 200 不代表刪完：一定要看 allRevoked。
import { admin, json, PayError, readJson, serve } from '../_shared/http.ts';
import { loadConfig } from '../_shared/env.ts';
import { createEcpayClient } from '../_shared/ecpayClient.ts';
import { isUuid } from '../_shared/payFlow.ts';
import { adminSecretOk, revokeAccountCards, RevokeRefused } from '../_shared/accountRevoke.ts';
import { createRevokeStore } from '../_shared/accountRevokeStore.ts';

serve('payment-admin-revoke-account-cards', async (req) => {
  const cfg = loadConfig();
  if (!adminSecretOk(req.headers.get('x-admin-secret') ?? '', cfg)) throw new PayError('FORBIDDEN', '沒有權限', 403);
  const b = await readJson(req);
  if (!isUuid(b.userId)) throw new PayError('REQUEST_INVALID', '請求格式不正確（userId 要是 uuid）');
  try {
    const r = await revokeAccountCards({ store: createRevokeStore(admin()), gateway: createEcpayClient(cfg.ecpay), bindMerchantId: cfg.bindMerchantId, now: Date.now }, b.userId);
    console.log('[admin-revoke] done', JSON.stringify({ allRevoked: r.allRevoked, queryOk: r.queryOk, ecpayRemaining: r.ecpayRemaining, siteRemaining: r.siteRemaining,
      cards: r.cards.map((c) => c.result), orphans: r.orphans.map((o) => o.result) }));
    return json(req, { ok: true, ...r });
  } catch (e) {
    if (e instanceof RevokeRefused) throw new PayError(e.code, e.message, e.code === 'USER_NOT_FOUND' ? 404 : 409, { retryAfter: e.retryAfter });
    throw e;
  }
});
