import { describe, expect, it } from 'vitest';
import { analyzeFileSet } from './fileset';
import { convertSheets } from './convert';
import { buildPreview } from './preview';
import { buildImportItemDrafts } from './items';
import { readShopeeFile } from './sheet';
import { fakeGrids, toXlsx, type FakeProduct } from './test-fixtures';
import type { ImportIndex } from '../../types';
import type { ParsedProduct, PreviewOptions } from './types';

const OFF: PreviewOptions = { skipSoldOut: false, allHidden: false };
const v = (id: string, price: number, stock: number, name = '') => ({ id, name, price, stock });
const prod = (id: string, stock: number, extra: Partial<FakeProduct> = {}): FakeProduct => ({
  id, name: `假商品 ${id} 號`, variants: [v(`9${id}`, 100, stock)], ...extra,
});
function parse(products: FakeProduct[]): ParsedProduct[] {
  const g = fakeGrids(products);
  const a = analyzeFileSet([
    readShopeeFile('a.xlsx', toXlsx(g.basic)), readShopeeFile('b.xlsx', toXlsx(g.sales)), readShopeeFile('c.xlsx', toXlsx(g.media)),
  ]);
  return convertSheets(a.sheets!);
}
const index = (entries: [string, 'active' | 'hidden'][]): ImportIndex => ({
  products: entries.map(([id, status]) => ({ sourceProductId: id, productId: `P${id}`, status, variants: [] })),
  images: [], lastImport: null,
});
const actions = (ps: ParsedProduct[], idx: ImportIndex | null, o: PreviewOptions = OFF) =>
  Object.fromEntries(buildPreview(ps, idx, o).rows.map((r) => [r.sourceProductId, r.action]));

describe('buildPreview 計數', () => {
  const ps = parse([prod('1', 5), prod('2', 0), prod('3', 5, { name: 'abc' }), prod('4', 0)]);

  it('X + Y + E + S = 檔案商品數；新增／錯誤', () => {
    const pv = buildPreview(ps, null, OFF);
    expect(pv.counts).toMatchObject({ total: 4, created: 3, updated: 0, errors: 1, skipped: 0 });
    expect(pv.counts.created + pv.counts.updated + pv.counts.errors + pv.counts.skipped).toBe(4);
    expect(pv.canStart).toBe(true);
  });

  it('略過已售完：只影響新增商品', () => {
    expect(actions(ps, null, { skipSoldOut: true, allHidden: false })).toEqual({ 1: 'create', 2: 'skip', 3: 'error', 4: 'skip' });
    // 已存在的售完商品不被略過，一律更新（Q-2）
    expect(actions(ps, index([['2', 'active']]), { skipSoldOut: true, allHidden: false })).toEqual({ 1: 'create', 2: 'update', 3: 'error', 4: 'skip' });
  });

  it('有錯誤的商品即使已存在也算錯誤，不算更新', () => {
    expect(actions(ps, index([['3', 'active']]))['3']).toBe('error');
  });

  it('全部都錯誤 → 不能開始匯入', () => {
    const pv = buildPreview(parse([prod('1', 5, { name: 'abc' })]), null, OFF);
    expect(pv.canStart).toBe(false);
  });
});

describe('buildPreview 匯入後狀態', () => {
  const ps = parse([prod('1', 5), prod('2', 0), prod('5', 1, { variants: [v('51', 10, 0, '甲'), v('52', 20, 4, '乙')] })]);
  const status = (idx: ImportIndex | null, o: PreviewOptions = OFF) =>
    Object.fromEntries(buildPreview(ps, idx, o).rows.map((r) => [r.sourceProductId, r.afterStatus]));

  it('新增：有庫存上架、售完下架；部分規格為 0 照常上架', () => {
    expect(status(null)).toEqual({ 1: 'active', 2: 'hidden', 5: 'active' });
  });

  it('新增＋全部先下架：全部下架', () => {
    expect(status(null, { skipSoldOut: false, allHidden: true })).toEqual({ 1: 'hidden', 2: 'hidden', 5: 'hidden' });
  });

  it('更新：全規格 0 → 下架；其餘維持原狀；「全部先下架」不影響既有商品', () => {
    const idx = index([['1', 'hidden'], ['2', 'active'], ['5', 'active']]);
    expect(status(idx)).toEqual({ 1: 'hidden', 2: 'hidden', 5: 'active' });
    expect(status(idx, { skipSoldOut: false, allHidden: true })).toEqual({ 1: 'hidden', 2: 'hidden', 5: 'active' });
    const idx2 = index([['1', 'active']]);
    expect(buildPreview(ps, idx2, { skipSoldOut: false, allHidden: true }).rows[0].afterStatus).toBe('active');
  });

  it('error／skip 沒有匯入後狀態', () => {
    const pv = buildPreview(parse([prod('1', 0), prod('2', 5, { name: 'abc' })]), null, { skipSoldOut: true, allHidden: false });
    expect(pv.rows.map((r) => r.afterStatus)).toEqual([null, null]);
  });
});

describe('buildPreview 提醒與分類修改', () => {
  const ps = parse([
    prod('1', 5, { category: '999999 - Unknown' }),
    prod('2', 5, { category: '999999 - Unknown', name: '補差額專用連結' }),
    prod('3', 5),
    prod('4', 5, { category: '999999 - Unknown', name: 'abc' }),
  ]);

  it('W 只算會匯入的商品；同一件多個提醒只算一次；分項依商品件數', () => {
    const c = buildPreview(ps, null, OFF).counts;
    expect(c.warnings).toBe(2);
    expect(c.warningsByCode).toEqual({ CATEGORY_OTHER: 2, LOOKS_LIKE_TOP_UP: 1, DESCRIPTION_OVER_EDITOR_LIMIT: 0 });
    expect(c.problems).toBe(c.errors + c.warnings);
    expect(c.problems).toBe(3);
  });

  it('改分類：提醒消失、W 重算；草稿帶新分類', () => {
    const pv = buildPreview(ps, null, OFF, { '1': 'toys' });
    expect(pv.counts.warnings).toBe(1);
    expect(pv.rows[0].warnings).toEqual([]);
    expect(pv.rows[0].categoryId).toBe('toys');
    expect(buildImportItemDrafts(ps, pv)[0].categoryId).toBe('toys');
  });

  it('把分類改回「其他」會重新出現提醒', () => {
    const pv = buildPreview(ps, null, OFF, { '3': 'other' });
    expect(pv.rows[2].warnings.map((w) => w.code)).toEqual(['CATEGORY_OTHER']);
  });

  it('商品列欄位：封面、規格數、價格範圍、總庫存', () => {
    const r = buildPreview(parse([prod('7', 0, { variants: [v('71', 300, 2, '甲'), v('72', 150, 1, '乙')] })]), null, OFF).rows[0];
    expect(r).toMatchObject({ variantCount: 2, priceMin: 150, priceMax: 300, totalStock: 3, coverUrl: 'https://img.test/7/cover', action: 'create' });
  });
});

describe('buildImportItemDrafts', () => {
  it('只含 create／update、依檔案順序；圖片只有 sourceUrl 與 slot', () => {
    const ps = parse([
      prod('1', 5, { images: ['https://img.test/1/a'], options: [{ name: '甲', image: 'https://img.test/1/opt' }], variants: [{ id: '11', name: '甲,大', price: 10, stock: 1 }] }),
      prod('2', 0), prod('3', 5, { name: 'abc' }),
    ]);
    const pv = buildPreview(ps, null, { skipSoldOut: true, allHidden: false });
    const drafts = buildImportItemDrafts(ps, pv);
    expect(drafts.map((d) => d.sourceProductId)).toEqual(['1']);
    expect(drafts[0]).toEqual({
      sourceProductId: '1', title: '假商品 1 號', description: '', categoryId: 'games', status: 'active',
      images: [{ sourceUrl: 'https://img.test/1/cover', slot: 'cover' }, { sourceUrl: 'https://img.test/1/a', slot: 'image:1' }],
      variants: [{ sourceVariantId: '11', name: '甲 / 大', price: 10, stock: 1, image: { sourceUrl: 'https://img.test/1/opt', slot: 'option:甲' } }],
    });
  });
});
