import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { classifyEcpayMessage, createPayoutClient } from './payoutClient.ts';
import { decryptData } from './ecpayCrypto.ts';
import { TEST_CFG } from './ecpayTestKit.ts';

const fx = (name: string) => new Uint8Array(readFileSync(new URL(`./fixtures/payout/${name}`, import.meta.url)));
type Reply = Response | 'timeout';
function fakeMedia(reply: () => Reply) {
  const calls: { url: string; outer: string; data: Record<string, unknown> }[] = [];
  const fetchFn = (async (url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    calls.push({ url: String(url), outer: body.MerchantID, data: await decryptData(body.Data, TEST_CFG.hashKey, TEST_CFG.hashIv) });
    const r = reply();
    if (r === 'timeout') throw new DOMException('timed out', 'TimeoutError');
    return r;
  }) as unknown as typeof fetch;
  return { fetchFn, calls };
}
const NOW = Date.UTC(2026, 9, 21, 7, 10);
const csvResponse = (bytes: Uint8Array) => new Response(bytes, { status: 200, headers: { 'content-type': 'text/plain', 'content-disposition': 'attachment;filename=TradeMedia_20261021151000.csv' } });

describe('payoutClient.download（35670 QueryTradeMedia）', () => {
  it('送出的請求：同 ecpayment 外殼（平台商編號＋PlatformID）、依結算日（DateType 1）、只查信用卡；回 CSV 位元組原樣交回', async () => {
    const f = fakeMedia(() => csvResponse(fx('ac-r6.csv')));
    const c = createPayoutClient(TEST_CFG, f.fetchFn, () => NOW);
    const r = await c.download({ merchantId: '3999001', dateType: 'settle', from: '2026-10-07', to: '2026-10-21' });
    expect(r).toMatchObject({ kind: 'file' });
    if (r.kind === 'file') expect(r.bytes).toEqual(fx('ac-r6.csv'));
    expect(f.calls).toHaveLength(1);
    expect(f.calls[0].url).toBe('https://ecpayment-stage.ecpay.com.tw/1.0.0/Cashier/QueryTradeMedia');
    expect(f.calls[0].outer).toBe('3003008');
    expect(f.calls[0].data).toEqual({ PlatformID: '3003008', MerchantID: '3999001', DateType: '1', BeginDate: '2026-10-07', EndDate: '2026-10-21', PaymentType: '01' });
  });
  it('依撥款日查 → DateType 2；設了轉送網址（D46 固定 IP）就打轉送網址', async () => {
    const f = fakeMedia(() => csvResponse(fx('header-only.csv')));
    const c = createPayoutClient({ ...TEST_CFG, payoutBase: 'https://relay.example/ecpay' }, f.fetchFn, () => NOW);
    await c.download({ merchantId: '3999001', dateType: 'payout', from: '2026-10-01', to: '2026-10-02' });
    expect(f.calls[0].url).toBe('https://relay.example/ecpay/1.0.0/Cashier/QueryTradeMedia');
    expect(f.calls[0].data.DateType).toBe('2');
  });
  it('範圍超過上限 → 不呼叫綠界，直接丟錯（呼叫端要先拆段）', async () => {
    const f = fakeMedia(() => csvResponse(fx('header-only.csv')));
    const c = createPayoutClient(TEST_CFG, f.fetchFn, () => NOW);
    await expect(c.download({ merchantId: '3999001', dateType: 'settle', from: '2026-09-01', to: '2026-10-21' })).rejects.toThrow();
    expect(f.calls).toHaveLength(0);
  });
  it('HTTP 錯誤、逾時 → ECPAY_UNAVAILABLE', async () => {
    for (const reply of [() => new Response('oops', { status: 502 }), () => 'timeout' as const]) {
      const c = createPayoutClient(TEST_CFG, fakeMedia(reply).fetchFn, () => NOW);
      expect(await c.download({ merchantId: '3999001', dateType: 'settle', from: '2026-10-07', to: '2026-10-21' })).toMatchObject({ kind: 'error', code: 'ECPAY_UNAVAILABLE' });
    }
  });
  it('回的是 JSON 封包（TransCode≠1）→ 依訊息分類，訊息帶回', async () => {
    const c = createPayoutClient(TEST_CFG, fakeMedia(() => Response.json({ TransCode: 999, TransMsg: 'IP is not allowed' })).fetchFn, () => NOW);
    expect(await c.download({ merchantId: '3999001', dateType: 'settle', from: '2026-10-07', to: '2026-10-21' })).toEqual({ kind: 'error', code: 'ECPAY_DENIED', message: 'IP is not allowed' });
  });
});

describe('classifyEcpayMessage：綠界回錯的訊息 → 代碼（§7.2）', () => {
  it('金鑰、編號、IP、權限 → ECPAY_DENIED（每家店都會一樣失敗，全部停）', () => {
    for (const m of ['MerchantID does not match the MerchantID in the encrypted data', 'The parameter [Data] decrypt fail', 'IP is not allowed', 'Permission denied', '廠商驗證失敗'])
      expect(classifyEcpayMessage(m)).toBe('ECPAY_DENIED');
  });
  it('頻率 → RATE_LIMITED；其他 → ECPAY_UNAVAILABLE', () => {
    expect(classifyEcpayMessage('Too many requests, only one file per minute')).toBe('RATE_LIMITED');
    expect(classifyEcpayMessage('下載頻率過高')).toBe('RATE_LIMITED');
    expect(classifyEcpayMessage('Date range must not be greater than one month.')).toBe('ECPAY_UNAVAILABLE');
    expect(classifyEcpayMessage('System busy')).toBe('ECPAY_UNAVAILABLE');
  });
  it('小q：不能因為訊息裡剛好有 ip／不符 就判全部停（multiple、equipment、日期格式不符）', () => {
    for (const m of ['Multiple requests are being processed', 'equipment maintenance', '日期格式不符', 'Description error', 'MerchantTradeNo is required'])
      expect(classifyEcpayMessage(m)).toBe('ECPAY_UNAVAILABLE');
    expect(classifyEcpayMessage('Your IP address 1.2.3.4 is not in whitelist')).toBe('ECPAY_DENIED');
  });
});
