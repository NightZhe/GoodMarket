import { describe, expect, it } from 'vitest';
import { clampQty, overlayOps, queueOp, sameCart, validCartCount, withQty, withoutItems, type CartOp } from './cart';
import type { CartItem, Product } from '../../types';

const c = (p: string, v: string, qty: number): CartItem => ({ productId: p, variantId: v, qty });

describe('clampQty', () => {
  it.each([[0, 1], [-5, 1], [1, 1], [2.9, 2], [999, 999], [1000, 999], [NaN, 1], [Infinity, 1]])('%s → %s', (n, e) => expect(clampQty(n)).toBe(e));
});

describe('樂觀更新', () => {
  const cart = [c('a', '1', 1), c('a', '2', 2), c('b', '1', 3)];
  it('改數量只動那一列，且夾住範圍', () => {
    expect(withQty(cart, { productId: 'a', variantId: '2' }, 5)[1].qty).toBe(5);
    expect(withQty(cart, { productId: 'a', variantId: '2' }, 5000)[1].qty).toBe(999);
    expect(withQty(cart, { productId: 'a', variantId: '2' }, 5)[0].qty).toBe(1);
  });
  it('品項 key 是（商品、規格）：同商品不同規格不會被一起刪', () => {
    expect(withoutItems(cart, [{ productId: 'a', variantId: '1' }])).toEqual([c('a', '2', 2), c('b', '1', 3)]);
  });
});

describe('離線佇列', () => {
  it('同一品項只留最後一次修改', () => {
    let ops: CartOp[] = [];
    ops = queueOp(ops, { type: 'qty', productId: 'a', variantId: '1', qty: 2 });
    ops = queueOp(ops, { type: 'qty', productId: 'a', variantId: '1', qty: 4 });
    ops = queueOp(ops, { type: 'qty', productId: 'b', variantId: '1', qty: 1 });
    expect(ops).toEqual([{ type: 'qty', productId: 'a', variantId: '1', qty: 4 }, { type: 'qty', productId: 'b', variantId: '1', qty: 1 }]);
  });
  it('先改數量再刪除：只留刪除', () => {
    let ops = queueOp([], { type: 'qty', productId: 'a', variantId: '1', qty: 2 });
    ops = queueOp(ops, { type: 'delete', productId: 'a', variantId: '1' });
    expect(ops).toEqual([{ type: 'delete', productId: 'a', variantId: '1' }]);
  });
  it('重新讀回伺服器資料時，把還沒寫進去的修改疊回去，使用者剛改的值不會跳回去', () => {
    const server = [c('a', '1', 1), c('b', '1', 1)];
    const ops: CartOp[] = [{ type: 'qty', productId: 'a', variantId: '1', qty: 7 }, { type: 'delete', productId: 'b', variantId: '1' }];
    expect(overlayOps(server, ops)).toEqual([c('a', '1', 7)]);
  });
});

describe('validCartCount：圖示數字只算還買得到的', () => {
  const prod = (id: string, status: 'active' | 'hidden', variantIds: string[]): Product => ({
    id, shopId: 's', title: '', description: '', categoryId: 'other', images: [], sold: 0, rating: 0, location: '', freeShipping: false,
    status, createdAt: '', variants: variantIds.map(v => ({ id: v, name: v, price: 1, stock: 1 })),
  });
  const products = new Map([['a', prod('a', 'active', ['1'])], ['h', prod('h', 'hidden', ['1'])]]);
  it('下架、規格不在、商品不存在都不算', () => {
    expect(validCartCount([c('a', '1', 2), c('a', '9', 5), c('h', '1', 3), c('gone', '1', 4)], id => products.get(id))).toBe(2);
  });
  it('空購物車是 0', () => expect(validCartCount([], () => undefined)).toBe(0));
});

describe('sameCart：別台裝置改過才算「購物車已更新」', () => {
  it('內容一樣（不分順序）＝沒變', () => {
    expect(sameCart([c('a', '1', 1), c('b', '1', 2)], [c('b', '1', 2), c('a', '1', 1)])).toBe(true);
    expect(sameCart([], [])).toBe(true);
  });
  it('數量不同、多一項、少一項、換了品項＝有變', () => {
    expect(sameCart([c('a', '1', 1)], [c('a', '1', 2)])).toBe(false);
    expect(sameCart([c('a', '1', 1)], [c('a', '1', 1), c('b', '1', 1)])).toBe(false);
    expect(sameCart([c('a', '1', 1), c('b', '1', 1)], [c('a', '1', 1)])).toBe(false);
    expect(sameCart([c('a', '1', 1)], [c('a', '2', 1)])).toBe(false);
  });
});
