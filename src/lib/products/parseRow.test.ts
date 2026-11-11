import { describe, expect, it, vi } from 'vitest';
import { parseProductRow, parseProductRows, parseVariants } from './parseRow';

const row = (over: Record<string, unknown> = {}) => ({
  id: 'p1', shop_id: 's1', title: '測試商品', description: '說明', category_id: 'home',
  images: ['https://example.com/a.jpg', 'art:🎧:#fff:#000'],
  variants: [{ id: 'v1', name: '預設', price: 100, stock: 5 }],
  sold: 3, rating: '4.5', location: '台北', free_shipping: true, status: 'active',
  created_at: '2026-01-01T00:00:00Z',
  ...over,
});

describe('商品資料防禦性解析：variants', () => {
  it('形狀不符的 variants 回 null', () => {
    for (const bad of [{}, [null], 'x', [], null, undefined, 5, [[]], [{}]]) {
      expect(parseVariants(bad)).toBeNull();
    }
  });

  it('元素缺必填欄位或型別不對就整體回 null', () => {
    const ok = { id: 'v1', name: 'a', price: 1, stock: 0 };
    expect(parseVariants([{ ...ok, price: undefined }])).toBeNull();
    expect(parseVariants([{ ...ok, price: '100' }])).toBeNull();
    expect(parseVariants([{ ...ok, price: NaN }])).toBeNull();
    expect(parseVariants([{ ...ok, stock: '3' }])).toBeNull();
    expect(parseVariants([{ ...ok, stock: undefined }])).toBeNull();
    expect(parseVariants([{ ...ok, id: 1 }])).toBeNull();
    expect(parseVariants([{ ...ok, id: '' }])).toBeNull();
    expect(parseVariants([{ ...ok, name: null }])).toBeNull();
    expect(parseVariants([ok, null])).toBeNull();
  });

  it('正常資料原樣通過，含選填欄位', () => {
    const v = { id: 'v1', name: '黑 L', price: 100, originalPrice: 150, stock: 2, sourceId: '999', image: 'https://example.com/v.jpg' };
    expect(parseVariants([v])).toEqual([v]);
  });

  it('選填欄位型別不對時略過該欄，白名單以外的欄位不帶入', () => {
    const out = parseVariants([{ id: 'v1', name: 'a', price: 1, stock: 0, originalPrice: null, sourceId: 5, image: {}, extra: 'x' }]);
    expect(out).toEqual([{ id: 'v1', name: 'a', price: 1, stock: 0 }]);
  });
});

describe('商品資料防禦性解析：整列', () => {
  it('正常資料轉成 Product', () => {
    expect(parseProductRow(row())).toEqual({
      id: 'p1', shopId: 's1', title: '測試商品', description: '說明', categoryId: 'home',
      images: ['https://example.com/a.jpg', 'art:🎧:#fff:#000'],
      variants: [{ id: 'v1', name: '預設', price: 100, stock: 5 }],
      sold: 3, rating: 4.5, location: '台北', freeShipping: true, status: 'active', createdAt: '2026-01-01T00:00:00Z',
    });
  });

  it('images 形狀不符的商品略過', () => {
    expect(parseProductRow(row({ images: {} }))).toBeNull();
    expect(parseProductRow(row({ images: [1] }))).toBeNull();
    expect(parseProductRow(row({ images: ['a', null] }))).toBeNull();
    expect(parseProductRow(row({ images: null }))).toBeNull();
  });

  it('沒有圖片的商品照常載入（顯示層有占位）', () => {
    expect(parseProductRow(row({ images: [] }))?.images).toEqual([]);
  });

  it('variants 形狀不符的商品略過', () => {
    expect(parseProductRow(row({ variants: {} }))).toBeNull();
    expect(parseProductRow(row({ variants: [] }))).toBeNull();
    expect(parseProductRow(row({ variants: [{ id: 'v', name: 'n', stock: 1 }] }))).toBeNull();
  });

  it('title、description、id 不是字串的商品略過', () => {
    expect(parseProductRow(row({ title: 5 }))).toBeNull();
    expect(parseProductRow(row({ title: null }))).toBeNull();
    expect(parseProductRow(row({ description: {} }))).toBeNull();
    expect(parseProductRow(row({ id: undefined }))).toBeNull();
    expect(parseProductRow(row({ shop_id: 1 }))).toBeNull();
    expect(parseProductRow(row({ status: 'weird' }))).toBeNull();
    expect(parseProductRow(null)).toBeNull();
    expect(parseProductRow('x')).toBeNull();
  });

  it('次要欄位型別不對時用預設值，不整件丟掉', () => {
    const p = parseProductRow(row({ sold: 'x', rating: 'abc', location: null, free_shipping: 'yes', created_at: 5 }));
    expect(p).toMatchObject({ sold: 0, rating: 0, location: '', freeShipping: false, createdAt: '' });
  });

  it('一筆壞資料不影響其他商品；警告只含商品 id', () => {
    const warn = vi.fn();
    const out = parseProductRows([row({ id: 'a' }), row({ id: 'bad', variants: {}, title: '秘密標題' }), row({ id: 'c' })], warn);
    expect(out.map(p => p.id)).toEqual(['a', 'c']);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(warn.mock.calls[0])).toContain('bad');
    expect(JSON.stringify(warn.mock.calls[0])).not.toContain('秘密標題');
  });
});
