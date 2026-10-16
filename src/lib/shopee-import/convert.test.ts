import { describe, expect, it } from 'vitest';
import { analyzeFileSet } from './fileset';
import { convertSheets, flattenVariantName, matchOption } from './convert';
import { readShopeeFile } from './sheet';
import { fakeGrids, SAMPLE, toXlsx, type FakeProduct, type FakeGrids } from './test-fixtures';
import type { ParsedProduct } from './types';

function parse(grids: FakeGrids): ParsedProduct[] {
  const a = analyzeFileSet([
    readShopeeFile('a.xlsx', toXlsx(grids.basic)),
    readShopeeFile('b.xlsx', toXlsx(grids.sales)),
    readShopeeFile('c.xlsx', toXlsx(grids.media)),
  ]);
  if (!a.sheets) throw new Error(`三檔不齊全：${a.issues.map((i) => i.message).join('；')}`);
  return convertSheets(a.sheets);
}
const one = (p: FakeProduct) => parse(fakeGrids([p]))[0];
const base: FakeProduct = { id: '1', name: '五個字的名稱', variants: [{ id: '10', name: '', price: 100, stock: 1 }] };

describe('flattenVariantName / matchOption', () => {
  it('空白 → 標準款；半形逗號 → 「 / 」', () => {
    expect(flattenVariantName('')).toBe('標準款');
    expect(flattenVariantName('  ')).toBe('標準款');
    expect(flattenVariantName('二手,現貨')).toBe('二手 / 現貨');
    expect(flattenVariantName('單層')).toBe('單層');
  });

  it('規格圖對應：相等或以「O,」開頭；多個符合取最長', () => {
    const opts = [{ name: '二手' }, { name: '二手(外盒不佳)' }, { name: '' }];
    expect(matchOption('二手', opts)?.name).toBe('二手');
    expect(matchOption('二手,現貨', opts)?.name).toBe('二手');
    expect(matchOption('二手(外盒不佳),現貨', opts)?.name).toBe('二手(外盒不佳)');
    expect(matchOption('二手現貨', opts)).toBeNull(); // 沒有逗號分隔不算
    expect(matchOption('全新', opts)).toBeNull();
    expect(matchOption('', opts)).toBeNull();
  });
});

describe('convertSheets 轉換', () => {
  const ps = parse(fakeGrids(SAMPLE));

  it('三檔聯集、順序依 basic', () => {
    expect(ps.map((p) => p.sourceProductId)).toEqual(['1001', '1002', '1003']);
  });

  it('名稱去空白、描述 CRLF→LF 並去頭尾空白、emoji 保留', () => {
    expect(ps[0].description).toBe('第一行\n第二行 😀');
  });

  it('規格攤平、空白名稱為標準款、價格庫存為整數', () => {
    expect(ps[0].variants.map((v) => [v.name, v.price, v.stock])).toEqual([
      ['紅 / 大', 100, 3], ['紅 / 小', 90, 0], ['藍 / 大', 120, 5],
    ]);
    expect(ps[1].variants[0].name).toBe('標準款');
  });

  it('規格圖：紅色兩個規格共用同一張；藍色選項沒圖 → 無圖', () => {
    const [red1, red2, blue] = ps[0].variants;
    expect(red1.image).toEqual({ slot: 'option:紅', sourceUrl: 'https://img.test/1001/opt-red' });
    expect(red2.image).toEqual(red1.image);
    expect(blue.image).toBeNull();
  });

  it('商品圖：主圖在前、依欄位順序、最多 9 張；slot 帶出欄位編號', () => {
    expect(ps[0].images.map((i) => i.slot)).toEqual(['cover', 'image:1', 'image:2']);
    const nine = one({ ...base, images: Array.from({ length: 8 }, (_, i) => `https://img.test/x/${i}`) });
    expect(nine.images).toHaveLength(9);
  });

  it('副圖欄位中間有空格時，保留相對順序並保留原欄位編號（略過圖片回報用）', () => {
    const g = fakeGrids([{ ...base, images: ['https://img.test/a', 'https://img.test/b', 'https://img.test/c'] }]);
    g.media[6][g.media[0].indexOf('ps_item_image.2')] = '';
    const p = parse(g)[0];
    expect(p.images.map((i) => [i.slot, i.sourceUrl.slice(-1)])).toEqual([['cover', 'r'], ['image:1', 'a'], ['image:3', 'c']]);
  });

  it('分類：對照表、表外歸其他', () => {
    expect(ps.map((p) => p.mappedCategoryId)).toEqual(['games', 'games', 'other']);
    expect(ps[2].shopeeCategoryId).toBe('999999');
  });

  it('售完＝所有規格庫存皆 0；部分為 0 不算', () => {
    expect(ps.map((p) => p.soldOut)).toEqual([false, false, true]);
  });

  it('ID 是數字儲存格時仍以字串保存', () => {
    const g = fakeGrids([base]);
    const asNum = (grid: typeof g.basic, col: number) => grid.map((r, i) => (i < 6 ? r : r.map((v, c) => (c === col ? (Number(v) as unknown as string) : v))));
    const a = analyzeFileSet([
      readShopeeFile('a.xlsx', toXlsx(asNum(g.basic, 0))), readShopeeFile('b.xlsx', toXlsx(g.sales)), readShopeeFile('c.xlsx', toXlsx(asNum(g.media, 0))),
    ]);
    expect(convertSheets(a.sheets!)[0]).toMatchObject({ sourceProductId: '1', errors: [] });
  });
});

describe('商品層錯誤（F-2）', () => {
  const codes = (p: ParsedProduct) => p.errors.map((e) => e.code);

  it('TITLE_LENGTH：5–60 字；以 code point 計（60 個含 emoji 的字不超限）', () => {
    expect(codes(one({ ...base, name: '四個字啊' }))).toEqual(['TITLE_LENGTH']);
    expect(one({ ...base, name: '四個字啊' }).errors[0].message).toContain('目前 4 字');
    expect(codes(one({ ...base, name: 'a'.repeat(61) }))).toEqual(['TITLE_LENGTH']);
    const sixty = `${'😀'.repeat(30)}${'a'.repeat(30)}`;
    expect(sixty.length).toBe(90);
    expect(codes(one({ ...base, name: sixty }))).toEqual([]);
    expect(codes(one({ ...base, name: `  ${'a'.repeat(5)}  ` }))).toEqual([]);
  });

  it('MISSING_COVER：主圖空白（即使有副圖）', () => {
    const g = fakeGrids([{ ...base, images: ['https://img.test/a'] }]);
    g.media[6][g.media[0].indexOf('ps_item_cover_image')] = '';
    expect(codes(parse(g)[0])).toEqual(['MISSING_COVER']);
  });

  it('PRICE_INVALID：0、500000、小數、空白、千分位；訊息帶規格名與原值', () => {
    for (const bad of [0, 500000, '1.5', '', '1,500', '-5']) {
      const p = one({ ...base, variants: [{ id: '10', name: '甲', price: bad, stock: 1 }] });
      expect(codes(p)).toEqual(['PRICE_INVALID']);
      expect(p.errors[0].message).toContain('規格「甲」');
    }
    expect(one({ ...base, variants: [{ id: '10', name: '', price: 0, stock: 1 }] }).errors[0].message).toContain('「0」');
    expect(one({ ...base, variants: [{ id: '10', name: '', price: '', stock: 1 }] }).errors[0].message).toContain('（空白）');
    expect(codes(one({ ...base, variants: [{ id: '10', name: '', price: 499999, stock: 1 }] }))).toEqual([]);
    expect(codes(one({ ...base, variants: [{ id: '10', name: '', price: 1, stock: 1 }] }))).toEqual([]);
  });

  it('STOCK_INVALID：負數、小數、空白；0 合法', () => {
    for (const bad of [-1, '2.5', '']) {
      expect(codes(one({ ...base, variants: [{ id: '10', name: '', price: 5, stock: bad }] }))).toEqual(['STOCK_INVALID']);
    }
    expect(codes(one({ ...base, variants: [{ id: '10', name: '', price: 5, stock: 0 }] }))).toEqual([]);
  });

  it('VARIANT_NAME_DUPLICATE：攤平後同名（含兩個空白名稱）', () => {
    const p = one({ ...base, variants: [{ id: '10', name: '', price: 5, stock: 1 }, { id: '11', name: '', price: 6, stock: 1 }] });
    expect(codes(p)).toEqual(['VARIANT_NAME_DUPLICATE']);
    expect(p.errors[0].message).toContain('標準款');
  });

  it('DUPLICATE_ROW：basic／media 同商品兩列、sales 同規格 ID 兩列', () => {
    const g = fakeGrids([base]);
    g.basic.push([...g.basic[6]]);
    g.media.push([...g.media[6]]);
    g.sales.push([...g.sales[6]]);
    const p = parse(g)[0];
    expect(codes(p)).toEqual(['DUPLICATE_ROW', 'DUPLICATE_ROW', 'DUPLICATE_ROW']);
    expect(p.errors.map((e) => e.message.includes('商品標題及描述') || e.message.includes('價格及庫存') || e.message.includes('媒體資訊'))).toEqual([true, true, true]);
  });

  it('MISSING_IN_FILE：只報這一項，不附帶其他檔的內容檢查', () => {
    const g = fakeGrids([base, { id: '2', name: '另一件商品名稱', variants: [{ id: '20', name: '', price: 5, stock: 1 }] }]);
    g.sales = g.sales.filter((r, i) => i < 6 || r[0] !== '2');
    const ps = parse(g);
    expect(ps.map((p) => codes(p))).toEqual([[], ['MISSING_IN_FILE']]);
    expect(ps[1].errors[0].message).toContain('價格及庫存');
    expect(ps[1].presentIn).toEqual({ basic_info: true, sales_info: false, media_info: true });
  });

  it('同一商品多個問題各報一次', () => {
    const p = one({ ...base, name: 'abc', variants: [{ id: '10', name: '', price: 0, stock: -1 }] });
    expect(codes(p)).toEqual(['TITLE_LENGTH', 'PRICE_INVALID', 'STOCK_INVALID']);
  });
});

describe('商品層提醒', () => {
  it('LOOKS_LIKE_TOP_UP：名稱含補差／補價／補運，或最低規格價 < 10', () => {
    const codes = (p: FakeProduct) => one(p).warnings.map((w) => w.code);
    expect(codes({ ...base, name: '補差額專用連結' })).toEqual(['LOOKS_LIKE_TOP_UP']);
    expect(codes({ ...base, name: '補價專用連結啊' })).toEqual(['LOOKS_LIKE_TOP_UP']);
    expect(codes({ ...base, name: '補運專用連結啊' })).toEqual(['LOOKS_LIKE_TOP_UP']);
    expect(codes({ ...base, variants: [{ id: '10', name: '', price: 9, stock: 1 }] })).toEqual(['LOOKS_LIKE_TOP_UP']);
    expect(codes({ ...base, variants: [{ id: '10', name: '', price: 10, stock: 1 }] })).toEqual([]);
  });

  it('DESCRIPTION_OVER_EDITOR_LIMIT：> 3000 字（code point）才提醒；3000 不提醒；不是錯誤', () => {
    const over = one({ ...base, description: '😀'.repeat(3001) });
    expect(over.warnings.map((w) => w.code)).toEqual(['DESCRIPTION_OVER_EDITOR_LIMIT']);
    expect(over.errors).toEqual([]);
    expect(over.description).toHaveLength(6002); // 完整保留，不截斷
    expect(one({ ...base, description: '😀'.repeat(3000) }).warnings).toEqual([]);
    expect(one({ ...base, description: '短' }).warnings).toEqual([]);
  });
});
