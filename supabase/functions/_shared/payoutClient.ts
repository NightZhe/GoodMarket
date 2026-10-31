// 撥款對帳檔用戶端（35670 Cashier/QueryTradeMedia，D40＝A）。所有 HTTP 經由注入的 fetch，可以不連網測試。
// 外殼跟 ecpayClient.ts 的 ecpayment() 相同：外層 MerchantID＝平台商編號、Data 內帶 PlatformID、平台商金鑰 AES 加密。
// ⚠ 2026-10-21 綠界測試環境實打（t8-local-tests.md §1）：這樣送回「MerchantID does not match the MerchantID in the encrypted data」；
//   外層改成特約商店編號＋平台商金鑰回「The parameter [Data] decrypt fail」；只有特約商店自己的金鑰查得到資料。
//   平台商能不能代下載就是 U-R1，等綠界回覆；回覆前維持跟其他 API 一致的寫法，結果會被分類成 ECPAY_DENIED（全部停、人處理）。
// 回應不是封包而是 CSV 檔（content-disposition: attachment），錯誤也常是 HTTP 200＋CSV 裡的一列訊息（由 payoutFile 認出來）。
import { buildRequest, parseEnvelope, type EcpayEnvelope } from './ecpayCrypto.ts';
import type { EcpayConfig } from './ecpayClient.ts';
import { dayCount, MAX_RANGE_DAYS } from './payoutDates.ts';

export interface PayoutClientConfig extends EcpayConfig {
  /** D46＝A 的固定 IP 轉送服務網址（PR-B0）；沒設就直連 ecpaymentBase */
  payoutBase?: string;
}
export type PayoutErrorCode = 'ECPAY_UNAVAILABLE' | 'RATE_LIMITED' | 'ECPAY_DENIED';
export type DownloadResult = { kind: 'file'; bytes: Uint8Array } | { kind: 'error'; code: PayoutErrorCode; message: string };
export interface DownloadRequest { merchantId: string; dateType: 'settle' | 'payout'; from: string; to: string }

/** 單次下載逾時：測試環境一個 3.7MB 的檔花了 14.5 秒 */
export const DOWNLOAD_TIMEOUT_MS = 60_000;

/** 綠界回錯的訊息 → 代碼。綠界沒公布錯誤格式與代碼（摘要檔 §0），依實打看到的訊息與常見字樣判斷（未查證的字樣：IP、頻率） */
export function classifyEcpayMessage(msg: string): PayoutErrorCode {
  // 只認明確的字樣（小q：舊版結尾 IP 加 /i 會吃到 multiple／equipment、「不符」會吃到「日期格式不符」→ 誤判會讓排程全部停）
  if (/one file per minute|only one .*per minute|too many requests|rate limit|一分鐘.*一個|頻率過高|太頻繁/i.test(msg)) return 'RATE_LIMITED';
  if (/MerchantID does not match|decrypt fail|PlatformID|permission denied|access denied|forbidden/i.test(msg)
      || /(?<![A-Za-z])IP(?![A-Za-z])/.test(msg) || /權限|廠商驗證失敗|未開通|IP 位址|IP位址/.test(msg)) return 'ECPAY_DENIED';
  return 'ECPAY_UNAVAILABLE';
}

export function createPayoutClient(cfg: PayoutClientConfig, fetchFn: typeof fetch = fetch, nowMs: () => number = Date.now) {
  async function download(q: DownloadRequest): Promise<DownloadResult> {
    if (dayCount(q.from, q.to) > MAX_RANGE_DAYS) throw new Error(`查詢範圍 ${q.from}～${q.to} 超過 ${MAX_RANGE_DAYS} 天，要先拆段`);
    // 帳戶模式同 ecpayClient：平台商模式帶 PlatformID、外層是平台商；一般特店模式不帶、外層是本站商店編號（PR-乙 IN-B3）
    const data = { ...(cfg.platformId ? { PlatformID: cfg.platformId } : {}), MerchantID: q.merchantId, DateType: q.dateType === 'settle' ? '1' : '2', BeginDate: q.from, EndDate: q.to, PaymentType: '01' };
    const url = (cfg.payoutBase ?? cfg.ecpaymentBase).replace(/\/$/, '') + '/1.0.0/Cashier/QueryTradeMedia';
    let res: Response;
    try {
      const req = await buildRequest(cfg.platformId ?? cfg.merchantId, data, cfg.hashKey, cfg.hashIv, Math.floor(nowMs() / 1000));
      res = await fetchFn(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(req), signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
    } catch (e) {
      return { kind: 'error', code: 'ECPAY_UNAVAILABLE', message: e instanceof Error && e.name === 'TimeoutError' ? 'timeout' : 'network error' };
    }
    if (!res.ok) return { kind: 'error', code: 'ECPAY_UNAVAILABLE', message: `http ${res.status}` };
    let bytes: Uint8Array;
    try { bytes = new Uint8Array(await res.arrayBuffer()); } catch { return { kind: 'error', code: 'ECPAY_UNAVAILABLE', message: 'body read failed' }; }
    // 封包格式的錯誤（JSON，TransCode≠1）：文件沒寫會不會這樣回，兩種都接
    const head = new TextDecoder().decode(bytes.slice(0, 1)).trim();
    if (head === '{') {
      try {
        const env = JSON.parse(new TextDecoder().decode(bytes)) as EcpayEnvelope;
        const p = await parseEnvelope<Record<string, unknown>>(env, cfg.hashKey, cfg.hashIv);
        const msg = p.ok ? String(p.data.RtnMsg ?? 'unexpected envelope') : p.transMsg;
        return { kind: 'error', code: classifyEcpayMessage(msg), message: msg.slice(0, 200) };
      } catch { /* 不是 JSON，當成檔案交給解析器 */ }
    }
    return { kind: 'file', bytes };
  }
  return { download };
}
export type PayoutClient = ReturnType<typeof createPayoutClient>;
