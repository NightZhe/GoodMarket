import { createClient } from '@supabase/supabase-js';

// 金鑰從環境變數來。anon key 是設計上可公開的：資料安全靠 Supabase 的
// Row Level Security（supabase/schema.sql），不是靠把這把金鑰藏起來。
const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const isConfigured = Boolean(url && anonKey);

export const supabase = createClient(url ?? 'https://placeholder.supabase.co', anonKey ?? 'placeholder', {
  auth: { persistSession: true, autoRefreshToken: true },
});

/** Supabase 回傳 snake_case，App 內部一律 camelCase，轉換集中在這裡 */
export interface ShopRow {
  id: string; owner_id: string | null; name: string; avatar: string;
  description: string; location: string; rating: number; created_at: string;
}

export interface ProductRow {
  id: string; shop_id: string; title: string; description: string; category_id: string;
  images: string[];
  variants: { id: string; name: string; price: number; originalPrice?: number; stock: number }[];
  sold: number; rating: number; location: string;
  free_shipping: boolean; status: 'active' | 'hidden'; created_at: string;
}

export interface OrderRow {
  id: string; order_no: string; shop_id: string; lines: OrderLineRow[]; shipping_fee: number; total: number;
  carrier?: string | null; tracking_no?: string | null;
  events?: { status: string; at: string; carrier?: string | null; trackingNo?: string | null }[];
  status: 'to_ship' | 'shipping' | 'completed' | 'cancelled'; payment: 'cod' | 'card' | 'transfer';
  created_at: string; access_token?: string;
  buyer_name?: string; buyer_phone?: string; buyer_address?: string;
}

interface OrderLineRow {
  productId: string; variantId: string; title: string; variantName: string;
  image: string; price: number; qty: number;
}
