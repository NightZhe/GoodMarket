import { describe, expect, it } from 'vitest';
import { shippingFor } from './StoreContext';
import type { Product } from '../types';

// AC-25：前端算的每店運費必須跟伺服器（place_checked_order）同一條規則：
// 同店小計 ≥ 499，或該店這批商品全部免運 → 0；否則 60。期望值照規則手寫，不用程式重算。
const product = (id: string, freeShipping: boolean): Product => ({
  id, shopId: 's1', title: id, description: '', categoryId: '3c', images: [],
  variants: [], sold: 0, rating: 0, location: '', freeShipping, status: 'active', createdAt: '',
});

const allFree = [product('a', true), product('b', true)];
const partFree = [product('a', true), product('b', false)];
const noneFree = [product('a', false), product('b', false)];

describe('shippingFor 與伺服器同一條規則（AC-25 九格）', () => {
  it.each([
    [498, '全部免運', allFree, 0],
    [498, '部分免運', partFree, 60],
    [498, '都不免運', noneFree, 60],
    [499, '全部免運', allFree, 0],
    [499, '部分免運', partFree, 0],
    [499, '都不免運', noneFree, 0],
    [500, '全部免運', allFree, 0],
    [500, '部分免運', partFree, 0],
    [500, '都不免運', noneFree, 0],
  ] as const)('小計 %i、%s → 運費 %i', (subtotal, _label, products, fee) => {
    expect(shippingFor(subtotal, [...products])).toBe(fee);
  });
});

describe('shippingFor：沒有商品資料', () => {
  it('讀不到商品（undefined）不算免運：未滿 499 收 60', () => {
    expect(shippingFor(498, [undefined])).toBe(60);
    expect(shippingFor(498, [product('a', true), undefined])).toBe(60);
  });
  it('讀不到商品但小計滿 499 仍免運', () => {
    expect(shippingFor(499, [undefined])).toBe(0);
  });
});
