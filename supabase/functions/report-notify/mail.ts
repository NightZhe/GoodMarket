// 檢舉通知信的組信邏輯（純函式，不連網、不碰 Deno，可在 Node 下以 vitest 測試）。依 spec R-K8。
// 信件內容只放：檢舉編號、台北時間、目標類型、目標快照名稱、目標連結、原因、說明。
// 絕不放檢舉人 email／門號／帳號識別碼：ReportRow 型別本身就沒有 reporter_id，store 也不會去讀它。

export interface ReportRow {
  id: string;
  target_type: string;
  target_id: string;
  target_label: string;
  target_shop_id: string;
  reason: string;
  details: string | null;
  created_at: string;
  notified_at: string | null;
  notify_attempts: number;
}

export const SITE_BASE = 'https://nightzhe.github.io/GoodMarket/#';
export const BRAND = '好物集';

export const TARGET_TYPE_LABEL: Record<string, string> = { product: '商品', review: '評價', shop: '店家' };
// 原因文案＝前端選單文字（spec §7.3）
export const REASON_LABEL: Record<string, string> = {
  prohibited: '違禁或違法商品',
  counterfeit: '仿冒品或侵權',
  scam: '詐騙或不實資訊',
  offensive: '色情、暴力或令人不適',
  harassment: '騷擾、仇恨或洩露個資',
  other: '其他',
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: unknown): v is string => typeof v === 'string' && UUID_RE.test(v);

/** 去掉會讓標頭／內文被誤解的控制字元（換行改空白）。 */
const flat = (s: string) => s.replace(/[\u0000-\u001f\u007f-\u009f]+/g, ' ').trim();

export function taipeiTime(iso: string): string {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return iso;
  // 台灣沒有日光節約時間，固定 UTC+8
  return new Date(ms + 8 * 3600_000).toISOString().replace('T', ' ').slice(0, 19);
}

/** 目標連結。評價連到所屬商品的評價總覽；查不到所屬商品（評價已被刪）就退回店家頁。 */
export function targetLink(row: ReportRow, reviewProductId: string | null): string {
  if (row.target_type === 'product') return `${SITE_BASE}/product/${row.target_id}`;
  if (row.target_type === 'shop') return `${SITE_BASE}/shop/${row.target_id}`;
  if (row.target_type === 'review' && isUuid(reviewProductId)) return `${SITE_BASE}/product/${reviewProductId}/reviews`;
  return `${SITE_BASE}/shop/${row.target_shop_id}`;
}

export function buildSubject(row: ReportRow): string {
  const t = TARGET_TYPE_LABEL[row.target_type] ?? flat(row.target_type);
  const r = REASON_LABEL[row.reason] ?? flat(row.reason);
  return `[${BRAND}] 新檢舉：${t} ${r}`;
}

export function buildText(row: ReportRow, reviewProductId: string | null): string {
  const lines = [
    '好物集收到一筆新的檢舉。',
    '',
    `檢舉編號：${row.id}`,
    `時間（台北）：${taipeiTime(row.created_at)}`,
    `目標類型：${TARGET_TYPE_LABEL[row.target_type] ?? flat(row.target_type)}`,
    `目標名稱：${flat(row.target_label)}`,
    `目標連結：${targetLink(row, reviewProductId)}`,
    `原因：${REASON_LABEL[row.reason] ?? flat(row.reason)}`,
    '說明：',
    row.details && row.details.trim() !== '' ? row.details.replace(/\r\n?/g, '\n') : '（未填）',
    '',
    '——',
    '處理方式：用上面的檢舉編號到後台 reports 表查詢（這封信不含檢舉人資料）。',
  ];
  return lines.join('\n');
}

// ── 信箱位址 ──
export interface Mailbox { name?: string; addr: string }
const ADDR_RE = /^[^\s<>@,;:"()\\[\]]+@[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?$/;

/** 解析 `a@b.c` 或 `名稱 <a@b.c>`；不合格（含換行等控制字元）回 null。 */
export function parseMailbox(raw: string | undefined): Mailbox | null {
  if (!raw || /[\u0000-\u001f\u007f]/.test(raw)) return null;
  const s = raw.trim();
  const m = /^(.*)<([^<>]+)>$/.exec(s);
  if (m) {
    const addr = m[2].trim();
    if (!ADDR_RE.test(addr)) return null;
    const name = m[1].trim().replace(/^"(.*)"$/, '$1');
    return name ? { name, addr } : { addr };
  }
  return ADDR_RE.test(s) ? { addr: s } : null;
}

/** 收件人：以逗號分隔的一或多個位址；任何一個不合格就整個回 null。 */
export function parseRecipients(raw: string | undefined): string[] | null {
  if (!raw) return null;
  const parts = raw.split(',').map((p) => p.trim()).filter(Boolean);
  if (parts.length === 0 || parts.length > 5) return null;
  const out: string[] = [];
  for (const p of parts) {
    const mb = parseMailbox(p);
    if (!mb || mb.name) return null;
    out.push(mb.addr);
  }
  return out;
}

// ── MIME ──
const enc = new TextEncoder();
function b64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
/** RFC 2047 encoded-word；純 ASCII 且不含需轉義字元時原樣回傳。 */
export function encodeHeader(s: string): string {
  const v = flat(s);
  // eslint-disable-next-line no-control-regex
  if (/^[\x20-\x7e]*$/.test(v) && !v.includes('=?')) return v;
  // 每個 encoded-word ≤ 75 字元：以 code point 分段，每段 UTF-8 ≤ 42 bytes（base64 後 56 字元）
  const words: string[] = [];
  let cur = '';
  for (const ch of v) {
    if (enc.encode(cur + ch).length > 42) { words.push(cur); cur = ''; }
    cur += ch;
  }
  if (cur) words.push(cur);
  return words.map((w) => `=?UTF-8?B?${b64(enc.encode(w))}?=`).join('\r\n ');
}

const wrap76 = (s: string) => s.replace(/(.{76})/g, '$1\r\n').replace(/\r\n$/, '');

export function buildMime(o: { from: Mailbox; to: string[]; subject: string; text: string; date: Date; messageId: string }): string {
  const domain = o.from.addr.split('@')[1] ?? 'localhost';
  const fromHdr = `${o.from.name ? encodeHeader(o.from.name) + ' ' : ''}<${o.from.addr}>`;
  const headers = [
    `From: ${fromHdr}`,
    `To: ${o.to.join(', ')}`,
    `Subject: ${encodeHeader(o.subject)}`,
    `Date: ${o.date.toUTCString().replace('GMT', '+0000')}`,
    `Message-ID: <${o.messageId}@${domain}>`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
  ];
  return headers.join('\r\n') + '\r\n\r\n' + wrap76(b64(enc.encode(o.text.replace(/\r\n?|\n/g, '\r\n')))) + '\r\n';
}
