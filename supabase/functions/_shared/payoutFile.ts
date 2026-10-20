// 綠界撥款對帳檔（35670 Cashier/QueryTradeMedia）的解析器。純函式：位元組進、正規化的列出，不碰網路與資料庫。
// 格式依 2026-10-21 對綠界測試環境實打拿到的檔（.work/account-payment-methods/t8-local-tests.md §1），比文件多知道幾件事：
//   · UTF-8 加 BOM、CRLF；每一格寫成 Excel 公式樣式 ="…"（數字是 =123）。
//   · 結算日期、撥款日期實際是 yyyy/MM/dd（文件寫含時間）；撥款日期在撥款日到之前是空的。
//   · 退刷是獨立的一列：交易金額、手續費、淨額都是負數，退款金額欄是 0。
//   · 錯誤也是 HTTP 200＋CSV：表頭照常，下一列其他格都是「-」，錯誤訊息放在其中一格（目前看到在結算日期）。
// 規格：spec-payout-reconcile.md §4（AC-R1～R4）。只認得下面 COLUMNS 列的欄位；其他欄位（例如 63766 格式的卡號、發卡銀行）一律丟掉，不會出現在輸出裡。

export interface PayoutRow {
  /** 檔案裡的行號（表頭是第 1 行） */
  line: number;
  /** 同一個檔裡內容完全相同的第幾列（從 1 開始）：讓同日同金額的兩筆部分退款指紋不同（A-7） */
  occurrence: number;
  merchantTradeNo: string;
  ecpayTradeNo: string;
  tradeAt: string | null;
  payMethod: string | null;
  feeRate: string | null;
  settleDate: string | null;
  payoutDate: string | null;
  amount: number;
  gatewayFee: string | null;
  platformFee: number | null;
  refundAmount: number | null;
  netAmount: number | null;
  processingFee: string | null;
}

export interface InvalidRow {
  line: number;
  occurrence: number;
  reason: string;
  /** 只有認得的欄位的原始字串（不含卡號等其他欄位） */
  cells: Record<string, string>;
}

export type ParseResult =
  | { ok: true; encoding: 'utf-8' | 'big5'; totalRows: number; rows: PayoutRow[]; invalid: InvalidRow[] }
  | { ok: false; code: 'PARSE_ENCODING' | 'PARSE_HEADER'; message: string }
  | { ok: false; code: 'ECPAY_MESSAGE'; message: string; encoding: 'utf-8' | 'big5' };

type Field = Exclude<keyof PayoutRow, 'line' | 'occurrence'>;
/** 表頭名稱 → 欄位。required：缺了整個檔不能用（AC-R2）：對回訂單的兩個編號、交易金額、撥款日期 */
const COLUMNS: { header: string; field: Field; kind: 'text' | 'datetime' | 'date' | 'int' | 'decimal'; required: boolean }[] = [
  { header: '特店交易編號', field: 'merchantTradeNo', kind: 'text', required: true },
  { header: '綠界交易編號', field: 'ecpayTradeNo', kind: 'text', required: true },
  { header: '交易日期', field: 'tradeAt', kind: 'datetime', required: false },
  { header: '付款方式', field: 'payMethod', kind: 'text', required: false },
  { header: '手續費率', field: 'feeRate', kind: 'text', required: false },
  { header: '結算日期', field: 'settleDate', kind: 'date', required: false },
  { header: '撥款日期', field: 'payoutDate', kind: 'date', required: true },
  { header: '交易金額', field: 'amount', kind: 'int', required: true },
  { header: '金流手續費', field: 'gatewayFee', kind: 'decimal', required: false },
  { header: '平台手續費', field: 'platformFee', kind: 'int', required: false },
  { header: '退款金額', field: 'refundAmount', kind: 'int', required: false },
  { header: '應收款項(淨額)', field: 'netAmount', kind: 'int', required: false },
  { header: '金流處理費', field: 'processingFee', kind: 'decimal', required: false },
];

/** 依序試 UTF-8、Big5（都用 fatal：遇到不合法的位元組就算失敗）。BOM 由 TextDecoder 拿掉 */
function decode(bytes: Uint8Array): { text: string; encoding: 'utf-8' | 'big5' } | null {
  for (const encoding of ['utf-8', 'big5'] as const) {
    try {
      return { text: new TextDecoder(encoding, { fatal: true }).decode(bytes), encoding };
    } catch { /* 下一個 */ }
  }
  return null;
}

/** 一行 CSV 切成格：支援 "…" 引號（"" 跳脫）與綠界的 ="…" 寫法；每格去掉頭尾空白與 tab */
export function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let i = 0;
  for (;;) {
    while (line[i] === ' ' || line[i] === '\t') i++;
    if (line[i] === '=' && line[i + 1] === '"') i++;
    let cell = '';
    if (line[i] === '"') {
      i++;
      for (; i < line.length; i++) {
        if (line[i] === '"') { if (line[i + 1] === '"') { cell += '"'; i++; } else { i++; break; } } else cell += line[i];
      }
      while (i < line.length && line[i] !== ',') cell += line[i++];
    } else {
      while (i < line.length && line[i] !== ',') cell += line[i++];
      if (cell.startsWith('=')) cell = cell.slice(1);
    }
    out.push(cell.trim());
    if (i >= line.length) return out;
    i++; // 逗號
  }
}

const pad = (n: string) => n.padStart(2, '0');
function toDate(s: string): string | null | undefined {
  if (s === '' || s === '-') return null;
  const m = s.match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?$/) ?? s.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (!m) return undefined;
  const [y, mo, d] = [m[1], pad(m[2]), pad(m[3])];
  const t = new Date(`${y}-${mo}-${d}T00:00:00Z`);
  if (Number.isNaN(t.getTime()) || t.getUTCMonth() + 1 !== Number(mo) || t.getUTCDate() !== Number(d)) return undefined;
  return `${y}-${mo}-${d}`;
}
function toDateTime(s: string): string | null | undefined {
  if (s === '' || s === '-') return null;
  const m = s.match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (!m || toDate(`${m[1]}/${m[2]}/${m[3]}`) === undefined) return undefined;
  return `${m[1]}-${pad(m[2])}-${pad(m[3])} ${pad(m[4] ?? '0')}:${m[5] ?? '00'}:${m[6] ?? '00'}`;
}
const numText = (s: string) => s.replace(/[,\s]/g, '');
function toInt(s: string): number | null | undefined {
  if (s === '' || s === '-') return null;
  const t = numText(s);
  return /^-?\d{1,12}$/.test(t) ? Number(t) : undefined;
}
function toDecimal(s: string): string | null | undefined {
  if (s === '' || s === '-') return null;
  const t = numText(s);
  return /^-?\d{1,12}(\.\d{1,6})?$/.test(t) ? t : undefined;
}

/** 綠界的錯誤列：認得的欄位裡只有一格不是「-」，那一格就是訊息 */
function ecpayMessage(cells: Record<string, string>): string | null {
  const vals = Object.values(cells);
  const notDash = vals.filter((v) => v !== '-' && v !== '');
  return vals.length >= 3 && notDash.length === 1 && vals.filter((v) => v === '-').length >= vals.length - 1 ? notDash[0] : null;
}

export function parsePayoutFile(bytes: Uint8Array): ParseResult {
  const dec = decode(bytes);
  if (!dec) return { ok: false, code: 'PARSE_ENCODING', message: '檔案編碼無法辨識（不是 UTF-8 也不是 Big5）' };
  const lines = dec.text.replace(/^﻿/, '').split(/\r?\n/);
  const header = splitCsvLine(lines[0] ?? '').map((h) => h.replace(/^﻿/, '').trim());
  const index = new Map<Field, number>();
  for (const c of COLUMNS) { const at = header.indexOf(c.header); if (at >= 0) index.set(c.field, at); }
  const missing = COLUMNS.filter((c) => c.required && !index.has(c.field)).map((c) => c.header);
  if (missing.length) return { ok: false, code: 'PARSE_HEADER', message: `表頭缺少必要欄位：${missing.join('、')}` };

  const rows: PayoutRow[] = [];
  const invalid: InvalidRow[] = [];
  const seen = new Map<string, number>();
  let totalRows = 0;
  for (let n = 1; n < lines.length; n++) {
    if (lines[n].trim() === '') continue;
    const raw = splitCsvLine(lines[n]);
    const cells: Record<string, string> = {};
    for (const c of COLUMNS) if (index.has(c.field)) cells[c.header] = raw[index.get(c.field)!] ?? '';
    if (totalRows === 0) {
      const msg = ecpayMessage(cells);
      if (msg) return { ok: false, code: 'ECPAY_MESSAGE', message: msg, encoding: dec.encoding };
    }
    totalRows++;
    const key = JSON.stringify(cells);
    const occurrence = (seen.get(key) ?? 0) + 1;
    seen.set(key, occurrence);
    const row: Record<string, unknown> = { line: n + 1, occurrence };
    let reason: string | null = null;
    for (const c of COLUMNS) {
      const s = cells[c.header];
      if (s === undefined) { row[c.field] = null; continue; }
      const v = c.kind === 'text' ? (s === '' || s === '-' ? null : s) : c.kind === 'date' ? toDate(s) : c.kind === 'datetime' ? toDateTime(s)
        : c.kind === 'int' ? toInt(s) : toDecimal(s);
      if (v === undefined) { reason ??= `${c.header}格式不正確`; continue; }
      if (v === null && c.required && c.field !== 'payoutDate') { reason ??= `${c.header}是空的`; continue; }
      row[c.field] = v;
    }
    if (reason) invalid.push({ line: n + 1, occurrence, reason, cells });
    else rows.push(row as unknown as PayoutRow);
  }
  return { ok: true, encoding: dec.encoding, totalRows, rows, invalid };
}
