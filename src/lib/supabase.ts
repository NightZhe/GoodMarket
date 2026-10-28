import { createClient } from '@supabase/supabase-js';
import { isNative } from './native/platform';
import { authOptions } from './auth/clientOptions';
import { nativeSessionStore } from './native/sessionStore';

// 金鑰從環境變數來。anon key 是設計上可公開的：資料安全靠 Supabase 的
// Row Level Security（supabase/schema.sql），不是靠把這把金鑰藏起來。
const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const isConfigured = Boolean(url && anonKey);
export const supabaseUrl = url ?? '';
export const supabaseAnonKey = anonKey ?? '';

// auth 設定（PKCE、不自動抓 ?code=）集中在 auth/clientOptions.ts。
// App 內（keep-signed-in T1）：session 改存手機安全儲存（iOS Keychain／Android KeyStore），由 native/sessionStore 的轉接器接手，
// supabase-js 寫的所有 key（session、PKCE code verifier）都走它。isNative() 是同步判斷，client 建立時就能決定。
// 網頁版：不建轉接器，維持 supabase-js 預設（localStorage），設定與之前完全相同。
export const supabase = createClient(url ?? 'https://placeholder.supabase.co', anonKey ?? 'placeholder', {
  auth: authOptions(isNative() ? nativeSessionStore() : null),
});

/** Supabase 回傳 snake_case，App 內部一律 camelCase，轉換集中在這裡 */
export interface ShopRow {
  id: string; owner_id: string | null; name: string; avatar: string;
  description: string; location: string; rating: number; created_at: string;
}

export interface ProductRow {
  id: string; shop_id: string; title: string; description: string; category_id: string;
  images: string[];
  variants: { id: string; name: string; price: number; originalPrice?: number; stock: number; sourceId?: string; image?: string }[];
  sold: number; rating: number; location: string;
  free_shipping: boolean; status: 'active' | 'hidden'; created_at: string;
}

export interface OrderRow {
  id: string; order_no: string; shop_id: string; lines: OrderLineRow[]; shipping_fee: number; total: number;
  carrier?: string | null; tracking_no?: string | null;
  events?: { status: string; at: string; carrier?: string | null; trackingNo?: string | null }[];
  status: 'to_ship' | 'shipping' | 'completed' | 'cancelled'; payment: 'cod' | 'card' | 'transfer' | 'ecpay_card';
  created_at: string;
  buyer_name?: string; buyer_phone?: string; buyer_address?: string;
}

/** 賣家讀到的訂單（含收件資料）。買家自己的訂單走帳號版 RPC，沒有收件欄位，見 BuyerOrderRow */
export type ShopOrderRow = OrderRow;

/** 帳號版 RPC（get_account_orders、place_account_order…）回傳的訂單：沒有收件資料，也沒有任何身分憑證 */
export type BuyerOrderRow = Omit<OrderRow, 'buyer_name' | 'buyer_phone' | 'buyer_address'>;

const SHOP_ORDER_FIELDS = [
  'id', 'order_no', 'shop_id', 'lines', 'shipping_fee', 'total', 'status', 'payment', 'created_at',
  'carrier', 'tracking_no', 'events', 'buyer_name', 'buyer_phone', 'buyer_address',
] as const satisfies readonly (keyof ShopOrderRow)[];

/** 賣家端查詢 orders 時的 select 欄位清單（明確列出，禁止 select('*')） */
export const SHOP_ORDER_COLUMNS = SHOP_ORDER_FIELDS.join(',');

interface OrderLineRow {
  productId: string; variantId: string; title: string; variantName: string;
  image: string; price: number; qty: number;
}
