import { describe, expect, it } from 'vitest';
import { analyzeFileSet } from './fileset';
import { buildFailureFiles, backendItemErrorReason, coverImageFailureReason, skippedImageReason, slotLabel } from './failure';
import { readShopeeFile } from './sheet';
import { SAMPLE, fakeGrids, toXlsx } from './test-fixtures';

const grids = fakeGrids(SAMPLE);
const sheets = analyzeFileSet([
  readShopeeFile('basic.xlsx', toXlsx(grids.basic)), readShopeeFile('sales.xlsx', toXlsx(grids.sales)), readShopeeFile('media.xlsx', toXlsx(grids.media)),
]).sheets!;
const reasons = { '1001': '原因甲', '1003': '原因乙' };
const files = buildFailureFiles(sheets, reasons);

describe('buildFailureFiles', () => {
  it('三個檔：第 1–6 列原樣、資料列只含失敗商品的全部列、每列填原因', () => {
    expect(files.basic.rows.slice(0, 6)).toEqual(sheets.basic.headerRows);
    expect(files.basic.rows.slice(6).map((r) => [r[0], r[4]])).toEqual([['1001', '原因甲'], ['1003', '原因乙']]);
    // sales：1001 有 3 個規格、1003 有 1 個 → 4 列，每列都填原因（Q-7）
    expect(files.sales.rows.slice(6).map((r) => [r[0], r[10]])).toEqual([
      ['1001', '原因甲'], ['1001', '原因甲'], ['1001', '原因甲'], ['1003', '原因乙'],
    ]);
    expect(files.media.rows.slice(6)).toHaveLength(2);
    expect(files.basic.fileName).toBe('failed_basic.xlsx');
  });

  it('沒列入失敗的商品不出現；沒有失敗時三個檔仍存在、只有表頭', () => {
    expect(files.basic.rows.some((r) => r[0] === '1002')).toBe(false);
    const empty = buildFailureFiles(sheets, {});
    expect([empty.basic, empty.sales, empty.media].map((f) => f.rows.length)).toEqual([6, 6, 6]);
  });

  it('丟回步驟 1 可被辨識、商品數與列數正確、類型與店家 ID 不變（F-6.3）', () => {
    const back = [files.basic, files.sales, files.media].map((f) => readShopeeFile(f.fileName, f.bytes));
    const a = analyzeFileSet(back);
    expect(a.canProceed).toBe(true);
    expect(a.externalShopId).toBe('1234567');
    expect(a.totalProducts).toBe(2);
    expect(a.sheets?.sales.rowCount).toBe(4);
  });

  it('原檔沒有 et_title_reason 欄時補在最後', () => {
    const g = fakeGrids(SAMPLE);
    g.basic = g.basic.map((r) => r.slice(0, -1));
    const s = analyzeFileSet([
      readShopeeFile('basic.xlsx', toXlsx(g.basic)), readShopeeFile('sales.xlsx', toXlsx(g.sales)), readShopeeFile('media.xlsx', toXlsx(g.media)),
    ]).sheets!;
    const f = buildFailureFiles(s, reasons).basic;
    expect(f.rows[0].at(-1)).toBe('et_title_reason');
    expect(f.rows[6].at(-1)).toBe('原因甲');
  });
});

describe('原因文案（F-6.4）', () => {
  it('位置名稱', () => {
    expect(slotLabel('image:3')).toBe('商品圖片 3');
    expect(slotLabel('option:一般版')).toBe('選項「一般版」的圖片');
    expect(slotLabel('cover')).toBe('主商品圖片');
  });

  it('圖片失敗：商品失敗用、略過圖片用', () => {
    expect(coverImageFailureReason('IMAGE_DOWNLOAD_FAILED')).toContain('主商品圖片下載失敗（已重試 3 次）');
    expect(coverImageFailureReason('IMAGE_UPLOAD_FAILED')).toContain('主商品圖片上傳到好物集失敗（已重試 3 次）');
    expect(skippedImageReason('IMAGE_DOWNLOAD_FAILED', 'image:3')).toBe('商品圖片 3下載失敗，已略過');
    expect(skippedImageReason('IMAGE_UPLOAD_FAILED', 'option:一般版')).toBe('選項「一般版」的圖片上傳失敗，已略過');
  });

  it('後端錯誤碼對應中文；未知代碼顯示系統錯誤＋後端訊息', () => {
    expect(backendItemErrorReason('PRICE_INVALID', 'x')).toContain('1–499,999');
    expect(backendItemErrorReason('INTERNAL', 'db exploded')).toBe('系統錯誤：db exploded');
    expect(backendItemErrorReason('constructor', 'm')).toBe('系統錯誤：m');
  });
});
