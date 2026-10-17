import { supabase } from '../supabase';
import type { CartItem } from '../../types';
import { AccountError, classifyAccountError } from './errors';
import type { BuyerOrderRow } from '../supabase';

// 帳號版的資料庫呼叫都集中在這裡（介面見 .work/buyer-auth/interface.md）。
// 錯誤一律轉成 AccountError：呼叫端只看 kind（登入失效／後端未升級／網路／被拒絕）。

async function rpc<T>(fn: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw classifyAccountError(error);
  return data as T;
}

const fail = (error: { message: string; code?: string | null; hint?: string | null }): never => {
  throw classifyAccountError(error);
};

// ── 購物車 ──
// 讀、改數量、刪除走 PostgREST（RLS 只回自己的列）；加入一定走 RPC（原子累加，並驗商品、規格、庫存、自購）。

export async function fetchCart(): Promise<CartItem[]> {
  const { data, error } = await supabase.from('cart_items').select('product_id,variant_id,qty').order('created_at');
  if (error) return fail(error);
  return (data as { product_id: string; variant_id: string; qty: number }[])
    .map(r => ({ productId: r.product_id, variantId: r.variant_id, qty: r.qty }));
}

export const addToCartRpc = (item: CartItem) =>
  rpc<{ product_id: string; variant_id: string; qty: number }>('add_to_cart', {
    p_product_id: item.productId, p_variant_id: item.variantId, p_qty: item.qty,
  });

export async function updateCartQty(productId: string, variantId: string, qty: number): Promise<void> {
  const { error } = await supabase.from('cart_items').update({ qty }).eq('product_id', productId).eq('variant_id', variantId);
  if (error) fail(error);
}

export async function deleteCartRow(productId: string, variantId: string): Promise<void> {
  const { error } = await supabase.from('cart_items').delete().eq('product_id', productId).eq('variant_id', variantId);
  if (error) fail(error);
}

// ── 訂單 ──

export interface PlaceOrderInput {
  items: CartItem[];
  buyer: { name: string; phone: string; address: string };
  payment: 'cod' | 'card' | 'transfer';
  /** 從購物車勾選結帳＝true：資料庫在同一個交易裡把這批品項從帳號購物車移除；直接購買＝false */
  fromCart: boolean;
}

export const placeAccountOrder = (i: PlaceOrderInput) =>
  rpc<BuyerOrderRow[]>('place_account_order', {
    p_items: i.items.map(x => ({ productId: x.productId, variantId: x.variantId, qty: x.qty })),
    p_buyer: i.buyer, p_payment: i.payment, p_from_cart: i.fromCart,
  });

export const getAccountOrders = () => rpc<BuyerOrderRow[]>('get_account_orders');
export const cancelAccountOrder = (id: string) => rpc<BuyerOrderRow>('cancel_account_order', { p_id: id });
export const completeAccountOrder = (id: string) => rpc<BuyerOrderRow>('complete_account_order', { p_id: id });

export { AccountError };
