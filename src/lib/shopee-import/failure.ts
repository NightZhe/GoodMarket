import * as XLSX from 'xlsx';
import type { ImportFileKind } from '../../types';
import { KEY } from './constants';
import { cellText } from './sheet';
import type { ParsedSheet, SheetRow, SheetSet } from './types';

// ───────── 失敗原因文案（F-6.4；語意固定，措辭 T1 可潤飾）─────────

/** slot → 「商品圖片 n」或「選項「〈名稱〉」的圖片」 */
export function slotLabel(slot: string): string {
  if (slot === 'cover') return '主商品圖片';
  if (slot.startsWith('image:')) return `商品圖片 ${slot.slice('image:'.length)}`;
  if (slot.startsWith('option:')) return `選項「${slot.slice('option:'.length)}」的圖片`;
  return slot;
}

type ImageFailureCode = 'IMAGE_DOWNLOAD_FAILED' | 'IMAGE_UPLOAD_FAILED';

/** 主商品圖片失敗、整件不匯入時的原因（商品失敗用） */
export function coverImageFailureReason(code: ImageFailureCode): string {
  return code === 'IMAGE_DOWNLOAD_FAILED'
    ? '主商品圖片下載失敗（已重試 3 次），請確認網址可開啟'
    : '主商品圖片上傳到好物集失敗（已重試 3 次），請稍後再匯一次';
}

/** 副圖／規格圖失敗、已略過時的說明（略過圖片用） */
export function skippedImageReason(code: ImageFailureCode, slot: string): string {
  return `${slotLabel(slot)}${code === 'IMAGE_DOWNLOAD_FAILED' ? '下載' : '上傳'}失敗，已略過`;
}

const BACKEND_ITEM_REASON: Record<string, string> = {
  SOURCE_ID_INVALID: '商品或規格的 ID 格式不正確',
  DUPLICATE_IN_BATCH: '同一批裡這件商品出現了兩次',
  TITLE_LENGTH: '商品名稱需為 5–60 字',
  CATEGORY_INVALID: '分類不正確',
  STATUS_INVALID: '上下架狀態不正確',
  IMAGE_COUNT: '商品圖片需為 1–9 張',
  IMAGE_NOT_TRANSFERRED: '圖片尚未轉存到好物集',
  VARIANT_REQUIRED: '至少要有一個規格',
  VARIANT_NAME_INVALID: '規格名稱不可空白',
  VARIANT_NAME_DUPLICATE: '規格名稱重複',
  VARIANT_SOURCE_DUPLICATE: '規格 ID 重複',
  PRICE_INVALID: '規格價格需為 1–499,999 的整數',
  STOCK_INVALID: '規格庫存需為 0 以上的整數',
};

/** 後端 item 錯誤碼 → 中文（6.0）；未知代碼顯示「系統錯誤：〈後端 message〉」 */
export function backendItemErrorReason(code: string, message: string): string {
  return Object.hasOwn(BACKEND_ITEM_REASON, code) ? BACKEND_ITEM_REASON[code] : `系統錯誤：${message}`;
}

// ───────── 失敗原因檔（F-6.1）─────────

export interface FailureFile {
  kind: ImportFileKind;
  /** 建議檔名：failed_〈原檔名〉 */
  fileName: string;
  /** 完整內容：第 1–6 列表頭原樣＋失敗商品的全部列（含「失敗原因」欄） */
  rows: string[][];
  /** 寫好的 xlsx 位元組，T4 直接包成 Blob 下載 */
  bytes: Uint8Array;
}

export interface FailureFiles {
  basic: FailureFile;
  sales: FailureFile;
  media: FailureFile;
}

function buildOne(sheet: ParsedSheet, reasons: Readonly<Record<string, string>>): FailureFile {
  // 「失敗原因」欄：沿用原檔的 et_title_reason；原檔沒有才補在最後
  const reasonIdx = sheet.columnIndex.get(KEY.reason) ?? sheet.columnKeys.length;
  const width = Math.max(sheet.columnKeys.length, reasonIdx + 1);
  const widen = (r: string[]) => (r.length >= width ? r : [...r, ...Array<string>(width - r.length).fill('')]);

  const header = sheet.headerRows.map(widen);
  if (!sheet.columnIndex.has(KEY.reason)) {
    header[0][reasonIdx] = KEY.reason;
    header[2][reasonIdx] = '失敗原因';
  }

  const failedRows: string[][] = [];
  for (const row of sheet.rows as SheetRow[]) {
    const id = cellText(sheet, row, KEY.productId);
    if (!Object.hasOwn(reasons, id)) continue;
    const values = widen([...row.values]);
    values[reasonIdx] = reasons[id];
    failedRows.push(values);
  }

  const rows = [...header, ...failedRows];
  // 空字串寫成「沒有儲存格」，檔案跟蝦皮原檔一樣乾淨
  const ws = XLSX.utils.aoa_to_sheet(rows.map((r) => r.map((v) => (v === '' ? null : v))));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
  const out: ArrayBuffer | Uint8Array = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
  return {
    kind: sheet.kind,
    fileName: `failed_${sheet.fileName}`,
    rows,
    bytes: out instanceof Uint8Array ? out : new Uint8Array(out),
  };
}

/**
 * 失敗原因檔產生器（F-6.1、AC-68）：三個 xlsx，各自保留原檔第 1–6 列，
 * 資料列只含失敗商品的全部列，每列填「失敗原因」。商品 ID → 原因文字。
 * 沒有任何失敗商品也照常產生三個只有表頭的檔；是否要提供下載由畫面決定（F-4.2）。
 * 丟回步驟 1 可被辨識（第 2 列原樣保留，F-6.3）。
 */
export function buildFailureFiles(sheets: SheetSet, reasons: Readonly<Record<string, string>>): FailureFiles {
  return {
    basic: buildOne(sheets.basic, reasons),
    sales: buildOne(sheets.sales, reasons),
    media: buildOne(sheets.media, reasons),
  };
}
