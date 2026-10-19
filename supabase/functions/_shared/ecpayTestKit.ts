// 測試用：假的綠界伺服器。用綠界文件公開的範例 key/iv，不是任何真實金鑰。
import { decryptData, encryptData } from './ecpayCrypto.ts';
import type { EcpayConfig } from './ecpayClient.ts';

export const TEST_CFG: EcpayConfig = {
  env: 'stage', platformId: '3003008', hashKey: 'pwFHCqoQZGmho4w6', hashIv: 'EkRm7iFT261dpevs',
  ecpgBase: 'https://ecpg-stage.ecpay.com.tw', ecpaymentBase: 'https://ecpayment-stage.ecpay.com.tw',
};

export interface Call { path: string; outerMerchantId: string; data: Record<string, any> }
export type Handler = (path: string, data: Record<string, any>) => Record<string, any> | 'timeout' | 'http500' | { transCode: number; transMsg: string };

/** 回傳 fetch 與呼叫紀錄。handler 回物件＝加密後當 Data；'timeout'＝丟錯；'http500'＝500。 */
export function fakeEcpay(handler: Handler) {
  const calls: Call[] = [];
  const fetchFn = async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const u = new URL(String(url));
    const body = JSON.parse(String(init?.body));
    const data = await decryptData<Record<string, any>>(body.Data, TEST_CFG.hashKey, TEST_CFG.hashIv);
    calls.push({ path: u.pathname, outerMerchantId: body.MerchantID, data });
    const r = handler(u.pathname, data);
    if (r === 'timeout') throw new DOMException('timed out', 'TimeoutError');
    if (r === 'http500') return new Response('oops', { status: 500 });
    if ('transCode' in r && 'transMsg' in r && Object.keys(r).length === 2) {
      return Response.json({ MerchantID: body.MerchantID, TransCode: (r as any).transCode, TransMsg: (r as any).transMsg });
    }
    return Response.json({ MerchantID: body.MerchantID, TransCode: 1, TransMsg: 'Success!', Data: await encryptData(r, TEST_CFG.hashKey, TEST_CFG.hashIv) });
  };
  return { fetchFn: fetchFn as typeof fetch, calls };
}
