// 撥款對帳（spec-payout-reconcile.md §7、§10.2；工單 PR-B3）。只給排程與維運人員用，要 x-cron-secret（同 payment-sweep；密碼共用 PAYMENT_CRON_SECRET）。
// 跟付款函式分開部署：這支壞掉或停用不影響付款。
//   POST {mode:'tick'}                                    pg_cron 每分鐘：取一件工作 → 下載 35670 → 解析 → 寫入（一分鐘最多呼叫綠界一次）
//   POST {mode:'enqueue'}                                 pg_cron 每天 15:10（台灣）：每家要對帳的店排一件（依結算日回查 14 天）
//   POST {mode:'enqueue', from, to?, merchantId?}         回補：from～to（預設今天）拆成每段 ≤ 28 天，每家店（或指定那家）每段一件
//   POST {mode:'fetch', merchantId, dateType?, from, to, dryRun?}   人工重抓一家店一段日期（≤ 28 天）；dryRun 只回計數不寫入
//   POST multipart（mode=file, merchantId, dryRun, file=@檔案）     人工匯入從綠界後台下載的 CSV（D45／D46 的退路）
// 回應 {ok:true, ...} 或 {ok:false, error:{code, message}}（同 interface-payment.md §2）。
import { admin, json, PayError, readJson, serve } from '../_shared/http.ts';
import { loadConfig } from '../_shared/env.ts';
import { createPayoutClient } from '../_shared/payoutClient.ts';
import { createPayoutStore, enqueueBackfill, enqueueDaily } from '../_shared/payoutStore.ts';
import { importBytes, manualFetch, runTick } from '../_shared/payoutRunner.ts';
import { dayCount, isDate, MAX_RANGE_DAYS, splitRange, twToday } from '../_shared/payoutDates.ts';

const safeEqual = (a: string, b: string) => {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
};
const MAX_FILE_BYTES = 20 * 1024 * 1024;
const MERCHANT_RE = /^[0-9]{7,10}$/;
const bad = (message: string) => new PayError('REQUEST_INVALID', message, 400);

serve('payout-reconcile', async (req) => {
  const cfg = loadConfig();
  const given = req.headers.get('x-cron-secret') ?? '';
  if (!cfg.cronSecret || !safeEqual(given, cfg.cronSecret)) throw new PayError('FORBIDDEN', '沒有權限', 403);   // AC-R18：先驗密碼，什麼都還沒做

  const db = admin();
  const store = createPayoutStore(db);
  const gateway = createPayoutClient({ ...cfg.ecpay, payoutBase: Deno.env.get('PAYOUT_ECPAY_BASE_URL') || undefined });
  const deps = { store, gateway, now: Date.now };

  if ((req.headers.get('content-type') ?? '').startsWith('multipart/form-data')) {
    const len = Number(req.headers.get('content-length') ?? '0');
    if (len > MAX_FILE_BYTES + 64 * 1024) throw new PayError('FILE_TOO_LARGE', '檔案太大（上限 20 MB）', 413);
    let form: FormData;
    try { form = await req.formData(); } catch { throw bad('請求格式不正確（multipart）'); }
    const merchantId = String(form.get('merchantId') ?? '');
    const file = form.get('file');
    if (form.get('mode') !== 'file') throw bad('multipart 只支援 mode=file');
    if (!MERCHANT_RE.test(merchantId)) throw bad('merchantId 格式不正確（7 到 10 位數字）');
    if (!(file instanceof File)) throw bad('缺少 file');
    if (file.size > MAX_FILE_BYTES) throw new PayError('FILE_TOO_LARGE', '檔案太大（上限 20 MB）', 413);
    const dryRun = String(form.get('dryRun') ?? 'false') !== 'false';
    const r = await importBytes({ store, now: Date.now }, { merchantId, bytes: new Uint8Array(await file.arrayBuffer()), trigger: 'manual_file', dryRun });
    return json(req, r);
  }

  const body = await readJson(req);
  switch (body.mode) {
    case 'tick':
      return json(req, { ok: true, ...(await runTick(deps)) });
    case 'enqueue': {
      if (body.from === undefined) return json(req, { ok: true, ...(await enqueueDaily(db)) });
      const to = body.to ?? twToday(Date.now());
      if (!isDate(body.from) || !isDate(to) || body.from > to) throw bad('from／to 要是 YYYY-MM-DD，而且 from 不能晚於 to');
      if (body.merchantId != null && !MERCHANT_RE.test(String(body.merchantId))) throw bad('merchantId 格式不正確（7 到 10 位數字）');
      const segments = splitRange(body.from, to);
      return json(req, { ok: true, segments, ...(await enqueueBackfill(db, segments, body.merchantId == null ? null : String(body.merchantId))) });
    }
    case 'fetch': {
      const merchantId = String(body.merchantId ?? '');
      const dateType = body.dateType ?? 'settle';
      if (!MERCHANT_RE.test(merchantId)) throw bad('merchantId 格式不正確（7 到 10 位數字）');
      if (dateType !== 'settle' && dateType !== 'payout') throw bad('dateType 只能是 settle 或 payout');
      if (!isDate(body.from) || !isDate(body.to) || body.from > body.to) throw bad('from／to 要是 YYYY-MM-DD，而且 from 不能晚於 to');
      if (dayCount(body.from, body.to) > MAX_RANGE_DAYS) {
        throw new PayError('RANGE_TOO_LONG', `一次最多 ${MAX_RANGE_DAYS} 天（綠界限制 1 個月）；更長請拆開，或用 {"mode":"enqueue","from":…} 回補`, 400);
      }
      const r = await manualFetch(deps, { merchantId, dateType, from: body.from, to: body.to, dryRun: body.dryRun === true });
      if (!r.ok) throw new PayError(r.code, r.message, 429, { retryAfter: r.retryAfter });
      return json(req, r);
    }
    default:
      throw bad('mode 要是 tick、enqueue、fetch，或用 multipart 送 mode=file');
  }
});
