// 綠界「站內付 2.0」JS SDK（綁卡畫面）。卡號、有效期限、安全碼只輸入在綠界畫進頁面的欄位裡，我們的程式碼讀不到。
// SDK 相依 jQuery 3.x：沒有就動態載入（固定版本＋SRI 雜湊，內容被換掉瀏覽器會拒絕執行）。

const JQUERY_URL = 'https://code.jquery.com/jquery-3.7.1.min.js';
const JQUERY_SRI = 'sha256-/JqT3SQfawRcv/BIHPThkBvs0OEvtFFmqPF/lYI/Cxo=';

interface EcpayInfo { BindCardPayToken?: string }
export interface EcpayGlobal {
  ServerType: Record<'Stage' | 'Prod', unknown>;
  Language: { zhTW: unknown };
  initialize(serverType: unknown, isLoading: number, cb: (err: unknown) => void): void;
  addBindingCard(token: string, language: unknown, cb: (err: unknown) => void): void;
  getBindCardPayToken(cb: (info: EcpayInfo | null, err: unknown) => void): void;
}

declare global {
  interface Window { ECPay?: EcpayGlobal; jQuery?: unknown }
}

/** 只載入綠界自己的網域（伺服器給的網址，仍不盲信） */
const isEcpayUrl = (u: string): boolean => {
  try { const x = new URL(u); return x.protocol === 'https:' && /(^|\.)ecpay\.com\.tw$/.test(x.hostname); } catch { return false; }
};

function addScript(src: string, integrity?: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.async = true;
    if (integrity) { s.integrity = integrity; s.crossOrigin = 'anonymous'; }
    s.onload = () => resolve();
    s.onerror = () => { s.remove(); reject(new Error('script load failed')); };
    document.head.appendChild(s);
  });
}

let sdkPromise: Promise<EcpayGlobal> | null = null;

/** 載入 jQuery 與綠界 SDK（同一個頁面只載入一次；失敗時下次可重試） */
export function loadEcpaySdk(sdkUrl: string): Promise<EcpayGlobal> {
  if (!isEcpayUrl(sdkUrl)) return Promise.reject(new Error('sdk url not allowed'));
  sdkPromise ??= (async () => {
    if (!window.jQuery) await addScript(JQUERY_URL, JQUERY_SRI);
    if (!window.ECPay) await addScript(sdkUrl);
    if (!window.ECPay) throw new Error('ECPay missing');
    return window.ECPay;
  })().catch(e => { sdkPromise = null; throw e; });
  return sdkPromise;
}

/** 把 SDK 的 callback 風格包成 Promise；err 有值就 reject（不顯示綠界的原始文字，只寫日誌用的簡短訊息） */
export const ecpayStep = (run: (cb: (err: unknown) => void) => void): Promise<void> =>
  new Promise((resolve, reject) => run(err => (err ? reject(new Error('ecpay step failed')) : resolve())));

export const ecpayBindToken = (ecpay: EcpayGlobal): Promise<string> =>
  new Promise((resolve, reject) => ecpay.getBindCardPayToken((info, err) => {
    const t = info?.BindCardPayToken;
    if (err || !t) reject(new Error('card data invalid'));
    else resolve(t);
  }));
