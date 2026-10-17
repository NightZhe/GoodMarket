import type { CartItem, Product } from '../../types';

// 帳號版購物車的純邏輯：數量範圍、樂觀更新、離線時暫存的寫入佇列。

export const MAX_CART_QTY = 999;
export const clampQty = (n: number) => (Number.isFinite(n) ? Math.min(MAX_CART_QTY, Math.max(1, Math.floor(n))) : 1);

type Key = Pick<CartItem, 'productId' | 'variantId'>;
export const cartKey = (c: Key) => `${c.productId}|${c.variantId}`;
const same = (a: Key, b: Key) => a.productId === b.productId && a.variantId === b.variantId;

export const withQty = (cart: CartItem[], k: Key, qty: number): CartItem[] =>
  cart.map(c => (same(c, k) ? { ...c, qty: clampQty(qty) } : c));

export const withoutItems = (cart: CartItem[], keys: Key[]): CartItem[] =>
  cart.filter(c => !keys.some(k => same(c, k)));

/** 兩份購物車內容是否一樣（不分順序）。用來判斷「別台裝置改過」要不要宣告「購物車已更新」 */
export function sameCart(a: CartItem[], b: CartItem[]): boolean {
  if (a.length !== b.length) return false;
  const m = new Map(a.map(c => [cartKey(c), c.qty]));
  return b.every(c => m.get(cartKey(c)) === c.qty);
}

export type CartOp =
  | { type: 'qty'; productId: string; variantId: string; qty: number }
  | { type: 'delete'; productId: string; variantId: string };

/** 斷線時暫存還沒寫進帳號的修改：同一個品項只留最後一次（刪除之後的數量修改無意義，反之亦然） */
export function queueOp(ops: CartOp[], op: CartOp): CartOp[] {
  return [...ops.filter(o => !same(o, op)), op];
}

/** 把還沒寫進去的修改套在剛從伺服器讀回來的購物車上，重新整理不會讓使用者剛改的值跳回去 */
export function overlayOps(server: CartItem[], ops: CartOp[]): CartItem[] {
  let out = server;
  for (const o of ops) out = o.type === 'qty' ? withQty(out, o, o.qty) : withoutItems(out, [o]);
  return out;
}

/** 購物車圖示上的數字：只算還買得到的（商品存在、上架、規格還在），下架的列不灌水 */
export function validCartCount(cart: CartItem[], getProduct: (id: string) => Product | undefined): number {
  return cart.reduce((sum, c) => {
    const p = getProduct(c.productId);
    return p && p.status === 'active' && p.variants.some(v => v.id === c.variantId) ? sum + c.qty : sum;
  }, 0);
}
