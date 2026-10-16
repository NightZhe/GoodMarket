import { describe, expect, it } from 'vitest';
import { analyzeFileSet } from './fileset';
import { readShopeeFile } from './sheet';
import { fakeGrids, sampleBytes, SAMPLE, toXlsx } from './test-fixtures';
import type { FileIntake } from './types';

const files = (shopId = '1234567') => {
  const b = sampleBytes(shopId);
  return {
    basic: readShopeeFile('a.xlsx', b.basic), sales: readShopeeFile('b.xlsx', b.sales), media: readShopeeFile('c.xlsx', b.media), b,
  };
};
const codes = (xs: FileIntake[]) => analyzeFileSet(xs).issues.map((i) => i.code);

describe('readShopeeFile', () => {
  it('不看檔名、用第 2 列第 1 格辨識類型；ID 一律字串', () => {
    const f = files();
    expect(f.basic.ok && f.basic.sheet.kind).toBe('basic_info');
    expect(f.sales.ok && f.sales.sheet.kind).toBe('sales_info');
    expect(f.media.ok && f.media.sheet.kind).toBe('media_info');
    if (!f.sales.ok) throw new Error('unreachable');
    expect(f.sales.sheet.rowCount).toBe(5);
    expect(f.sales.sheet.productCount).toBe(3);
    expect(f.sales.sheet.externalShopId).toBe('1234567');
  });

  it('數字儲存格也轉成字串（賣家用 Excel 存過檔，ID 與價格會變成數字格）', () => {
    const g = fakeGrids(SAMPLE);
    const numeric = g.sales.map((r, i) => (i < 6 ? r : r.map((v, c) => (/^\d+$/.test(v) && c !== 0 ? Number(v) : v))));
    numeric[6][0] = 12345678901 as unknown as string;
    const r = readShopeeFile('s.xlsx', toXlsx(numeric));
    if (!r.ok) throw new Error('unreachable');
    expect(r.sheet.rows[0].values[0]).toBe('12345678901');
    expect(r.sheet.rows[0].values[2]).toBe('5001');
    expect(r.sheet.productIds[0]).toBe('12345678901');
  });

  it('不是 xlsx（純文字、PNG 開頭、空檔、壞 zip）→ NOT_SHOPEE_FILE', () => {
    const bad = [
      new TextEncoder().encode('a,b,c\n1,2,3'),
      Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      new Uint8Array(0),
      Uint8Array.from([0x50, 0x4b, 0x03, 0x04, 1, 2, 3, 4, 5]),
    ];
    for (const b of bad) expect(readShopeeFile('x.xlsx', b)).toEqual({ ok: false, fileName: 'x.xlsx', reason: 'NOT_SHOPEE_FILE' });
  });

  it('空白 xlsx、第 2 列第 1 格是未知類型 → NOT_SHOPEE_FILE', () => {
    expect(readShopeeFile('blank.xlsx', toXlsx([])).ok).toBe(false);
    const g = fakeGrids(SAMPLE);
    g.basic[1][0] = 'something_else';
    expect(readShopeeFile('x.xlsx', toXlsx(g.basic))).toMatchObject({ ok: false, reason: 'NOT_SHOPEE_FILE' });
  });

  it('dts_info → DTS_FILE；超過 10 MB → FILE_TOO_LARGE', () => {
    const g = fakeGrids(SAMPLE);
    g.sales[1][0] = 'dts_info';
    expect(readShopeeFile('d.xlsx', toXlsx(g.sales))).toMatchObject({ ok: false, reason: 'DTS_FILE' });
    expect(readShopeeFile('big.xlsx', new Uint8Array(10 * 1024 * 1024 + 1))).toMatchObject({ ok: false, reason: 'FILE_TOO_LARGE' });
  });

  it('全空白列略過；有內容但沒有商品 ID 的列記在 rowsWithoutProductId', () => {
    const g = fakeGrids(SAMPLE);
    g.basic.push(g.basic[2].map(() => ''));
    const orphan = g.basic[2].map(() => '');
    orphan[2] = '沒有 ID 的列';
    g.basic.push(orphan);
    const r = readShopeeFile('b.xlsx', toXlsx(g.basic));
    if (!r.ok) throw new Error('unreachable');
    expect(r.sheet.rowCount).toBe(4);
    expect(r.sheet.rowsWithoutProductId).toEqual([6 + 3 + 2]);
    expect(r.sheet.productCount).toBe(3);
  });
});

describe('analyzeFileSet', () => {
  it('三檔齊全、順序不拘 → 可前往', () => {
    const f = files();
    const a = analyzeFileSet([f.media, f.basic, f.sales]);
    expect(a.canProceed).toBe(true);
    expect(a.totalProducts).toBe(3);
    expect(a.externalShopId).toBe('1234567');
    expect(a.sheets?.media.kind).toBe('media_info');
  });

  it('E-1.1 缺檔：列出全部缺的類型', () => {
    const f = files();
    const a = analyzeFileSet([f.basic]);
    expect(a.canProceed).toBe(false);
    expect(a.issues[0]).toMatchObject({ code: 'MISSING_KIND', kinds: ['sales_info', 'media_info'] });
    expect(a.issues[0].message).toContain('價格及庫存（sales_info）');
    expect(a.sheets).toBeNull();
    expect(a.totalProducts).toBeNull();
  });

  it('E-1.2 同類型兩個：指出兩個檔名，且 sheets 為 null', () => {
    const f = files();
    const dup = readShopeeFile('dup.xlsx', f.b.sales);
    const a = analyzeFileSet([f.basic, f.sales, f.media, dup]);
    const issue = a.issues.find((i) => i.code === 'DUPLICATE_KIND');
    expect(issue).toMatchObject({ kind: 'sales_info', fileNames: ['b.xlsx', 'dup.xlsx'] });
    expect(a.canProceed).toBe(false);
    expect(a.sheets).toBeNull();
  });

  it('E-1.3／E-1.4／E-1.8 單檔問題不影響其他檔，但都要移除才能前往', () => {
    const f = files();
    const g = fakeGrids(SAMPLE);
    g.sales[1][0] = 'dts_info';
    const dts = readShopeeFile('dts.xlsx', toXlsx(g.sales));
    const junk = readShopeeFile('junk.xlsx', new TextEncoder().encode('hello'));
    const big = readShopeeFile('big.xlsx', new Uint8Array(11 * 1024 * 1024));
    const a = analyzeFileSet([f.basic, f.sales, f.media, dts, junk, big]);
    expect(a.issues.map((i) => i.code).sort()).toEqual(['DTS_FILE', 'FILE_TOO_LARGE', 'NOT_SHOPEE_FILE']);
    expect(a.sheets).not.toBeNull();
    expect(a.canProceed).toBe(false);
    expect(codes([f.basic, f.sales, f.media])).toEqual([]);
  });

  it('E-1.5 店家 ID 不一致：訊息帶出兩個 ID', () => {
    const f = files();
    const other = readShopeeFile('m.xlsx', sampleBytes('99999999').media);
    const a = analyzeFileSet([f.basic, f.sales, other]);
    const issue = a.issues.find((i) => i.code === 'SHOP_MISMATCH');
    expect(issue?.message).toContain('1234567');
    expect(issue?.message).toContain('99999999');
    expect(a.externalShopId).toBeNull();
  });

  it('E-1.6 缺必要欄位：訊息含中文欄名與欄位鍵', () => {
    const f = files();
    const g = fakeGrids(SAMPLE);
    const c = g.sales[0].indexOf('et_title_variation_price');
    const cut = g.sales.map((r) => r.filter((_, i) => i !== c));
    const a = analyzeFileSet([f.basic, readShopeeFile('s.xlsx', toXlsx(cut)), f.media]);
    const issue = a.issues.find((i) => i.code === 'MISSING_COLUMNS');
    expect(issue?.message).toContain('價格（et_title_variation_price）');
    expect(a.canProceed).toBe(false);
  });

  it('E-1.7 超過 500 件（三檔商品 ID 聯集）；500 件可以', () => {
    const many = (n: number) => Array.from({ length: n }, (_, i) => ({
      id: String(2000 + i), name: `假商品 ${i} 號`, variants: [{ id: String(9000 + i), name: '', price: 10, stock: 1 }],
    }));
    const run = (n: number) => {
      const g = fakeGrids(many(n));
      return analyzeFileSet([
        readShopeeFile('a.xlsx', toXlsx(g.basic)), readShopeeFile('b.xlsx', toXlsx(g.sales)), readShopeeFile('c.xlsx', toXlsx(g.media)),
      ]);
    };
    const over = run(501);
    expect(over.canProceed).toBe(false);
    expect(over.issues[0]).toMatchObject({ code: 'TOO_MANY_PRODUCTS', total: 501, limit: 500 });
    expect(over.issues[0].message).toContain('501');
    expect(run(500).canProceed).toBe(true);
  });
});
