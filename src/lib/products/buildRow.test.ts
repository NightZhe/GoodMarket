import { describe, expect, it } from 'vitest';
import type { Product } from '../../types';
import { buildProductRow, toVariantPayload } from './buildRow';

const product = (over: Partial<Product> = {}): Product => ({
  id: 'p1', shopId: 's1', title: 't', description: 'd', categoryId: 'home',
  images: ['https://example.com/a.jpg'],
  variants: [{ id: 'v1', name: 'a', price: 10, stock: 1 }],
  sold: 9, rating: 4, location: '高雄', freeShipping: true, status: 'active', createdAt: '2026-01-01',
  source: 'shopee', sourceProductId: '123',
  ...over,
});

describe('商品寫入欄位', () => {
  it('送出的 row 只有九個欄位', () => {
    const row = buildProductRow(product(), { id: 's9', location: '台北' });
    expect(Object.keys(row).sort()).toEqual([
      'category_id', 'description', 'free_shipping', 'images', 'location', 'shop_id', 'status', 'title', 'variants',
    ]);
    expect(row.shop_id).toBe('s9');
    expect(row.location).toBe('台北');
  });

  it('variants 只含白名單欄位，沒有 null、沒有多餘 key', () => {
    const dirty = {
      id: 'v1', name: 'a', price: 10, stock: 1, originalPrice: null, sourceId: null, image: undefined,
      internal: 'x', original: '12',
    } as unknown as Product['variants'][number];
    expect(toVariantPayload(dirty)).toEqual({ id: 'v1', name: 'a', price: 10, stock: 1 });
  });

  it('選填欄位有值時保留', () => {
    const v = { id: 'v1', name: 'a', price: 10, originalPrice: 20, stock: 1, sourceId: '5', image: 'https://example.com/v.jpg' };
    expect(toVariantPayload(v)).toEqual(v);
    const keys = Object.keys(buildProductRow(product({ variants: [v] }), { id: 's', location: '' }).variants[0]!);
    expect(keys.sort()).toEqual(['id', 'image', 'name', 'originalPrice', 'price', 'sourceId', 'stock']);
  });
});
