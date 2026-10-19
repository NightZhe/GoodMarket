// 綠界 ReturnURL（35601）：綁卡結果背景通知。給綠界伺服器打的，沒有使用者登入；以 AES 解密成功＋交易編號與會員編號吻合為準。
// 回 "1|OK" 綠界才不會重送。
import { admin } from '../_shared/http.ts';
import { loadConfig } from '../_shared/env.ts';
import { createEcpayClient } from '../_shared/ecpayClient.ts';
import { parseEnvelope } from '../_shared/ecpayCrypto.ts';
import { handleBindNotification } from '../_shared/bindFlow.ts';

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('method not allowed', { status: 405 });
  try {
    const cfg = loadConfig();
    const p = await parseEnvelope<Record<string, unknown>>(await req.json(), cfg.ecpay.hashKey, cfg.ecpay.hashIv);
    if (!p.ok) return new Response('0|bad envelope', { status: 400 });
    await handleBindNotification(admin(), cfg, createEcpayClient(cfg.ecpay), p.data);
    return new Response('1|OK', { headers: { 'Content-Type': 'text/plain' } });
  } catch (e) {
    console.error('[payment-bind-return]', e instanceof Error ? e.name : 'unknown');
    return new Response('0|error', { status: 400 });
  }
});
