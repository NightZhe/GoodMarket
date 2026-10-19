import { describe, expect, it } from 'vitest';
import { buildRequest, decryptData, encryptData, parseEnvelope, ecpayUrlEncode } from './ecpayCrypto.ts';

// 綠界文件「參數加密方式說明」(developers.ecpay.com.tw/35676) 公開的測試向量：
// 這組 key/iv 是綠界公開的測試環境資料，只用來對照文件的預期密文。
const DOC_KEY = 'pwFHCqoQZGmho4w6';
const DOC_IV = 'EkRm7iFT261dpevs';
const DOC_PLAIN = { Name: 'Test', ID: 'A123456789' };
const DOC_CIPHER = 'o4TJSHkQBM1bogbn5BNFRofCVTfsQjoqv/TX8DKn757fe5AoYzoalYmrMsGXTiwxGpI8NsE2vu4tScAwISx8kw==';

describe('ecpayCrypto', () => {
  it('encrypts to the exact ciphertext published in the ECPay doc', async () => {
    expect(await encryptData(DOC_PLAIN, DOC_KEY, DOC_IV)).toBe(DOC_CIPHER);
  });

  it('decrypts the doc ciphertext back to the original object', async () => {
    expect(await decryptData(DOC_CIPHER, DOC_KEY, DOC_IV)).toEqual(DOC_PLAIN);
  });

  it('round-trips non-ASCII text, spaces and symbols', async () => {
    const o = { ItemName: '好物集 貓咪#罐頭 (大)', TradeDesc: "it's 100% ~ok~ a+b" };
    expect(await decryptData(await encryptData(o, DOC_KEY, DOC_IV), DOC_KEY, DOC_IV)).toEqual(o);
  });

  it('rejects ciphertext made with a different key (wrong platform key)', async () => {
    const c = await encryptData(DOC_PLAIN, 'AAAAAAAAAAAAAAAA', DOC_IV);
    await expect(decryptData(c, DOC_KEY, DOC_IV)).rejects.toThrow();
  });

  it('rejects garbage that is not base64 ciphertext', async () => {
    await expect(decryptData('not-valid!!', DOC_KEY, DOC_IV)).rejects.toThrow();
  });

  it('URL-encodes like .NET: space is +, and !*()~\' are percent-encoded', () => {
    expect(ecpayUrlEncode("a b!*()~'")).toBe('a+b%21%2A%28%29%7E%27');
  });

  it('builds a request envelope with outer MerchantID = platform and an encrypted Data', async () => {
    const req = await buildRequest('3003008', { PlatformID: '3003008', MerchantID: '3002607' }, DOC_KEY, DOC_IV, 1700000000);
    expect(req.MerchantID).toBe('3003008');
    expect(req.RqHeader).toEqual({ Timestamp: 1700000000 });
    expect(await decryptData(req.Data, DOC_KEY, DOC_IV)).toEqual({ PlatformID: '3003008', MerchantID: '3002607' });
  });

  it('parses a response envelope: TransCode 1 returns the decrypted Data', async () => {
    const Data = await encryptData({ RtnCode: 1, RtnMsg: 'Success' }, DOC_KEY, DOC_IV);
    const r = await parseEnvelope({ MerchantID: '3003008', TransCode: 1, TransMsg: 'Success!', Data }, DOC_KEY, DOC_IV);
    expect(r).toEqual({ ok: true, data: { RtnCode: 1, RtnMsg: 'Success' } });
  });

  it('parses a response envelope: TransCode != 1 is a transport failure, no data', async () => {
    const r = await parseEnvelope({ TransCode: 0, TransMsg: 'bad timestamp' }, DOC_KEY, DOC_IV);
    expect(r).toEqual({ ok: false, transMsg: 'bad timestamp' });
  });

  it('parses the form-post OrderResultURL body (ResultData=<urlencoded JSON>)', async () => {
    const Data = await encryptData({ RtnCode: 1 }, DOC_KEY, DOC_IV);
    const body = 'ResultData=' + encodeURIComponent(JSON.stringify({ TransCode: 1, TransMsg: 'Success!', Data }));
    const { parseResultData } = await import('./ecpayCrypto.ts');
    expect(await parseResultData(body, DOC_KEY, DOC_IV)).toEqual({ ok: true, data: { RtnCode: 1 } });
  });
});
