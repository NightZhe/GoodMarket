import * as XLSX from 'xlsx';
import type { ImportFileKind } from '../../types';
import {
  FIRST_DATA_ROW_INDEX, HEADER_ROW_COUNT, KEY, MAX_FILE_BYTES, REQUIRED_COLUMNS,
} from './constants';
import type { FileIntake, ParsedSheet, SheetRow } from './types';

const KIND_BY_TYPE_CELL: Record<string, ImportFileKind> = {
  basic_info: 'basic_info',
  sales_info: 'sales_info',
  media_info: 'media_info',
};

// xlsx 是 zip：PK\x03\x04（一般）、PK\x05\x06（空 zip）、PK\x07\x08
function looksLikeZip(b: Uint8Array): boolean {
  return b.length >= 4 && b[0] === 0x50 && b[1] === 0x4b && (b[2] === 3 || b[2] === 5 || b[2] === 7);
}

function cellToString(v: unknown): string {
  if (v === null || v === undefined) return '';
  return typeof v === 'string' ? v : String(v);
}

function isBlankRow(values: string[]): boolean {
  return values.every((v) => v.trim() === '');
}

/**
 * 讀一個蝦皮匯出檔（F-1.2～F-1.5）。
 * - 不看檔名；以第 2 列第 1 格判斷類型
 * - 欄位以第 1 列機器欄位鍵對應，不靠位置
 * - 所有儲存格都轉成字串（ID 不可變數字）
 * 讀不開、不是 xlsx、或類型未知一律 NOT_SHOPEE_FILE（E-1.3）；dts_info 是 DTS_FILE（E-1.4）。
 */
export function readShopeeFile(fileName: string, data: ArrayBuffer | Uint8Array): FileIntake {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  if (bytes.byteLength > MAX_FILE_BYTES) return { ok: false, fileName, reason: 'FILE_TOO_LARGE' };
  if (!looksLikeZip(bytes)) return { ok: false, fileName, reason: 'NOT_SHOPEE_FILE' };

  let grid: string[][];
  try {
    // 蝦皮匯出檔的 <dimension> 寫成 A1、屬性不標準：SheetJS 能讀（read-excel-file 會只讀到 1 列）
    const wb = XLSX.read(bytes, { type: 'array', dense: true, sheets: 0 });
    const sheetName = wb.SheetNames[0];
    const ws = sheetName === undefined ? undefined : wb.Sheets[sheetName];
    if (!ws) return { ok: false, fileName, reason: 'NOT_SHOPEE_FILE' };
    const raw = XLSX.utils.sheet_to_json<unknown[]>(ws, {
      header: 1, raw: true, defval: '', blankrows: true,
    });
    grid = raw.map((r) => r.map(cellToString));
  } catch {
    // 壞檔、加密檔等：對使用者都是「不是蝦皮匯出的商品檔」
    return { ok: false, fileName, reason: 'NOT_SHOPEE_FILE' };
  }

  const typeCell = (grid[1]?.[0] ?? '').trim();
  if (typeCell === 'dts_info') return { ok: false, fileName, reason: 'DTS_FILE' };
  const kind = KIND_BY_TYPE_CELL[typeCell];
  if (kind === undefined) return { ok: false, fileName, reason: 'NOT_SHOPEE_FILE' };

  const width = Math.max(0, ...grid.slice(0, HEADER_ROW_COUNT).map((r) => r.length));
  const pad = (r: string[]) => (r.length >= width ? r : [...r, ...Array<string>(width - r.length).fill('')]);
  const headerRows = Array.from({ length: HEADER_ROW_COUNT }, (_, i) => pad(grid[i] ?? []));
  const columnKeys = headerRows[0].map((k) => k.trim());
  const columnIndex = new Map<string, number>();
  columnKeys.forEach((k, i) => {
    if (k !== '' && !columnIndex.has(k)) columnIndex.set(k, i);
  });

  const rows: SheetRow[] = [];
  for (let i = FIRST_DATA_ROW_INDEX; i < grid.length; i++) {
    const values = pad(grid[i]);
    if (isBlankRow(values)) continue;
    rows.push({ rowNumber: i + 1, values });
  }

  const idCol = columnIndex.get(KEY.productId);
  const productIds: string[] = [];
  const seen = new Set<string>();
  const rowsWithoutProductId: number[] = [];
  for (const row of rows) {
    const id = idCol === undefined ? '' : row.values[idCol].trim();
    if (id === '') {
      rowsWithoutProductId.push(row.rowNumber);
    } else if (!seen.has(id)) {
      seen.add(id);
      productIds.push(id);
    }
  }

  const missingColumns = REQUIRED_COLUMNS[kind].filter((c) => !columnIndex.has(c.key));
  const sheet: ParsedSheet = {
    kind,
    fileName,
    externalShopId: (grid[1]?.[3] ?? '').trim(),
    headerRows,
    columnKeys,
    columnIndex,
    rows,
    rowCount: rows.length,
    productIds,
    productCount: productIds.length,
    rowsWithoutProductId,
    missingColumns,
  };
  return { ok: true, fileName, sheet };
}

/** 取一列中某欄位鍵的值（去頭尾空白）；沒有該欄位回空字串 */
export function cellText(sheet: ParsedSheet, row: SheetRow, key: string): string {
  const i = sheet.columnIndex.get(key);
  return i === undefined ? '' : row.values[i].trim();
}
