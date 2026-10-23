// 三竹簡訊（Mitake）SmSend：門號轉換、內文、請求組裝、回覆解析、狀態碼分類。純函式，不碰網路與 Deno。
// 依據 B2C_MitakeAPI v2.14（SmSend 與附錄二 statuscode）與 Sample v1.01（POST、CharsetURL=UTF-8、form-urlencoded）。

/** 簡訊範本，與 .work/phone-otp-auth/templates/sms.txt 同一份字串（測試會比對）。{{ .Code }} 是 GoTrue 範本語法，這裡沿用方便對照。 */
export const SMS_TEMPLATE = '【好物集】你的驗證碼是 {{ .Code }}，5 分鐘內有效。請勿提供給任何人。';
export const renderSmsBody = (otp: string): string => SMS_TEMPLATE.replace('{{ .Code }}', otp);

/**
 * 只收台灣手機：去掉開頭一個 +（如果有）後必須是 8869 開頭共 12 碼。
 * GoTrue 實測（v2.197.0）給的是不帶 + 的 886912345678；官方文件範例是 +886912345678，兩種都收。
 * 送三竹時轉成文件格式 0912345678（去 886、補 0）：文件寫明 dstaddr 格式是 0912345678；
 * 三竹雖然會自己去掉 + 並把 88609 轉 8869，但那是 v2.14 才加的容錯，換版本不保證一致，所以不依賴它。
 */
export function toMitakeNumber(raw: string): string | null {
  const d = raw.startsWith('+') ? raw.slice(1) : raw;
  return /^8869\d{8}$/.test(d) ? '0' + d.slice(3) : null;
}

/** log 用：+886912345678（或不帶 +）→ +8869****678。不合格式的值只留頭尾，絕不整串寫進 log。 */
export function maskPhone(v: unknown): string {
  if (typeof v !== 'string' || v.length < 8) return '****';
  const d = v.startsWith('+') ? v.slice(1) : v;
  if (/^8869\d{8}$/.test(d)) return `+${d.slice(0, 4)}****${d.slice(-3)}`;
  return `${v.slice(0, 3)}****${v.slice(-2)}`;
}

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', 'host.docker.internal']);

/**
 * MITAKE_HOST → 基底網址。只放主機名（可帶 port）；沒寫 scheme 一律補 https://。
 * 唯一例外：本機演練的假三竹跑在 localhost／127.0.0.1／host.docker.internal，這些主機才允許明寫 http://。
 * 其他任何 http://、路徑、帳密、查詢字串都拒絕（回 null）。
 */
export function resolveMitakeBase(raw: string | undefined): string | null {
  if (!raw) return null;
  const m = /^(https?):\/\/(.+)$/i.exec(raw.trim());
  const scheme = m ? m[1].toLowerCase() : 'https';
  const rest = (m ? m[2] : raw.trim()).replace(/\/$/, '');
  if (!/^[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?(:\d{1,5})?$/.test(rest)) return null;
  if (scheme === 'http' && !LOCAL_HOSTS.has(rest.replace(/:\d+$/, '').toLowerCase())) return null;
  return `${scheme}://${rest}`;
}

export interface MitakeCreds { base: string; username: string; password: string }
export interface SmSendParams { dstaddr: string; smbody: string; clientid: string }

/** 有效期限（秒）：文件寫 vldtime 可填「整數值代表傳送後幾秒內有效」，OTP 有效 5 分鐘，過期的簡訊不必再送達。 */
export const VLDTIME_SEC = 300;

export function buildSmSendRequest(c: MitakeCreds, p: SmSendParams): { url: string; init: { method: 'POST'; headers: Record<string, string>; body: string } } {
  const body = new URLSearchParams({
    username: c.username, password: c.password, dstaddr: p.dstaddr, smbody: p.smbody,
    clientid: p.clientid,       // 三竹用它在 12 小時內擋重複發送
    vldtime: String(VLDTIME_SEC),
    smsPointFlag: '1',          // 回覆多帶 smsPoint（本則扣點）
  }).toString().replace(/\+/g, '%20'); // 空白一律 %20：不賭對方的解碼器會不會把 + 當空白
  return {
    url: `${c.base}/b2c/mtk/SmSend?CharsetURL=UTF-8`,
    init: { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body },
  };
}

export interface MitakeReply {
  statuscode: string;
  msgid: string | undefined;
  accountPoint: number | undefined;
  smsPoint: number | undefined;
  duplicate: boolean;
}

const toInt = (v: string | undefined) => (v !== undefined && /^\d{1,12}$/.test(v) ? Number(v) : undefined);

/** 純文字：第一行 [clientid]（沒帶 clientid 時是 [1]），之後 key=value。格式不符回 null（呼叫端當「結果未知」處理）。 */
export function parseMitakeReply(text: string): MitakeReply | null {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0 || !/^\[[^\]]{1,36}\]$/.test(lines[0])) return null;
  const kv = new Map<string, string>();
  for (const l of lines.slice(1)) {
    const i = l.indexOf('=');
    if (i <= 0) continue;
    const k = l.slice(0, i).trim().toLowerCase();
    if (kv.has(k)) { if (k === 'statuscode') return null; continue; } // 單筆回覆不該有兩個 statuscode
    kv.set(k, l.slice(i + 1).trim());
  }
  const sc = kv.get('statuscode');
  if (!sc || sc.length !== 1) return null;
  return {
    statuscode: sc,
    msgid: kv.get('msgid') || undefined,
    accountPoint: toInt(kv.get('accountpoint')),
    smsPoint: toInt(kv.get('smspoint')),
    duplicate: kv.get('duplicate') === 'Y',
  };
}

export type Severity = 'info' | 'warn' | 'error' | 'critical';
export type StatusOutcome = { ok: true } | { ok: false; reason: string; severity: Severity };

/**
 * 附錄二 statuscode 分類（對照 spec-mitake.md R-M6）。成功：0、1，以及 2（已送達業者）、4（已送達手機）——
 * 把 2、4 當失敗的話 GoTrue 會丟掉這個碼，使用者會收到一則驗不過的簡訊。
 * 失敗只決定 log 的 reason 與嚴重度；回給 GoTrue 的內容一律相同（不洩漏三竹細節）。
 */
export function classifyStatus(code: string): StatusOutcome {
  if (code.length === 1 && '0124'.includes(code)) return { ok: true };
  if (code.length !== 1) return { ok: false, reason: 'mitake_other', severity: 'error' };
  if ('efhmn'.includes(code)) return { ok: false, reason: 'mitake_account', severity: 'critical' };  // 帳密錯、過期、停用、須改密碼
  if ('kp'.includes(code)) return { ok: false, reason: 'mitake_access', severity: 'critical' };      // IP 鎖、無 HTTP 權限
  if (code === 's') return { ok: false, reason: 'mitake_billing', severity: 'critical' };           // 帳務失敗（點數用完等）
  if ('abr*'.includes(code)) return { ok: false, reason: 'mitake_down', severity: 'warn' };         // 暫停服務、系統錯誤
  if (code === 'l') return { ok: false, reason: 'mitake_busy', severity: 'warn' };                  // 同時連線數上限
  if ('v6'.includes(code)) return { ok: false, reason: 'mitake_bad_number', severity: 'info' };     // 門號無效
  if ('cduy5x'.includes(code)) return { ok: false, reason: 'mitake_request', severity: 'error' };   // 我們組的請求有問題
  return { ok: false, reason: 'mitake_other', severity: 'error' };
}
