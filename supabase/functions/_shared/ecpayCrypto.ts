// 綠界站內付 2.0 / 信用卡綁定 API 的加解密與封包。純函式，只用 Web Crypto（Deno 與 Node 20+ 都有），不碰環境變數。
// 規格：developers.ecpay.com.tw/35676「參數加密方式說明」——
//   Data JSON → URLEncode → AES-128-CBC（PKCS7，key/iv 為 HashKey/HashIV 的 16 個字元）→ Base64。

const te = new TextEncoder();
const td = new TextDecoder();

/** .NET 風格的 URLEncode：空白變 +，並把 JS 不編碼的 !*()'~ 也編碼，大寫十六進位。 */
export function ecpayUrlEncode(s: string): string {
  return encodeURIComponent(s)
    .replace(/%20/g, '+')
    .replace(/[!'()*~]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());
}

const urlDecode = (s: string) => decodeURIComponent(s.replace(/\+/g, '%20'));

const importKey = (key: string) => crypto.subtle.importKey('raw', te.encode(key), { name: 'AES-CBC' }, false, ['encrypt', 'decrypt']);

function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function fromBase64(b64: string): Uint8Array<ArrayBuffer> {
  const bin = atob(b64); // 不是合法 Base64 會丟 InvalidCharacterError
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export async function encryptData(obj: unknown, key: string, iv: string): Promise<string> {
  const buf = await crypto.subtle.encrypt({ name: 'AES-CBC', iv: te.encode(iv) }, await importKey(key), te.encode(ecpayUrlEncode(JSON.stringify(obj))));
  return toBase64(new Uint8Array(buf));
}

export async function decryptData<T = Record<string, unknown>>(b64: string, key: string, iv: string): Promise<T> {
  const buf = await crypto.subtle.decrypt({ name: 'AES-CBC', iv: te.encode(iv) }, await importKey(key), fromBase64(b64));
  return JSON.parse(urlDecode(td.decode(buf))) as T;
}

export interface EcpayRequest {
  MerchantID: string;
  RqHeader: { Timestamp: number };
  Data: string;
}

/** 外層 MerchantID 一律是平台商編號（35591／35596／35630 的平台商模式）；timestamp 是 Unix 秒。 */
export async function buildRequest(outerMerchantId: string, data: unknown, key: string, iv: string, timestampSec: number): Promise<EcpayRequest> {
  return { MerchantID: outerMerchantId, RqHeader: { Timestamp: timestampSec }, Data: await encryptData(data, key, iv) };
}

export interface EcpayEnvelope {
  MerchantID?: string;
  TransCode?: number;
  TransMsg?: string;
  Data?: string;
}

export type ParsedEnvelope<T> = { ok: true; data: T } | { ok: false; transMsg: string };

/** TransCode 1＝封包收到；實際結果看 Data 解密後的 RtnCode。TransCode 不是 1 就沒有可用的 Data。 */
export async function parseEnvelope<T = Record<string, unknown>>(env: EcpayEnvelope, key: string, iv: string): Promise<ParsedEnvelope<T>> {
  if (env.TransCode !== 1 || !env.Data) return { ok: false, transMsg: String(env.TransMsg ?? 'no Data') };
  return { ok: true, data: await decryptData<T>(env.Data, key, iv) };
}

/** OrderResultURL 是瀏覽器 form post：application/x-www-form-urlencoded，欄位 ResultData＝URL 編碼過的封包 JSON。 */
export async function parseResultData<T = Record<string, unknown>>(formBody: string, key: string, iv: string): Promise<ParsedEnvelope<T>> {
  const raw = new URLSearchParams(formBody).get('ResultData');
  if (!raw) return { ok: false, transMsg: 'missing ResultData' };
  return parseEnvelope<T>(JSON.parse(raw) as EcpayEnvelope, key, iv);
}
