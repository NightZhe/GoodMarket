// 綠界 ReturnURL：幕後授權的付款結果背景通知（35630 要求必填）。沒有使用者登入；AES 解密成功才採信。回 "1|OK"。
// 只把「結果不明（calling）」的授權推進成 authorized；之後是否請款由補償程序（payment-status／payment-sweep）統一決定。
import { admin } from '../_shared/http.ts';
import { loadConfig } from '../_shared/env.ts';
import { parseEnvelope } from '../_shared/ecpayCrypto.ts';
import { handlePayNotification } from '../_shared/payFlow.ts';

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('method not allowed', { status: 405 });
  try {
    const cfg = loadConfig();
    const p = await parseEnvelope<Record<string, unknown>>(await req.json(), cfg.ecpay.hashKey, cfg.ecpay.hashIv);
    if (!p.ok) return new Response('0|bad envelope', { status: 400 });
    await handlePayNotification(admin(), p.data);
    return new Response('1|OK', { headers: { 'Content-Type': 'text/plain' } });
  } catch (e) {
    console.error('[payment-pay-return]', e instanceof Error ? e.name : 'unknown');
    return new Response('0|error', { status: 400 });
  }
});
