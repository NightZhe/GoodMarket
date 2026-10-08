// 領域模型：之後接真後端（Spring Boot / Node）時，這些型別就是 API 契約的起點

export type CategoryId =
  | 'women' | 'men' | 'beauty' | '3c' | 'home' | 'food' | 'sports' | 'baby';

export interface Category {
  id: CategoryId;
  name: string;
  icon: string;
}

export interface Shop {
  id: string;
  name: string;
  avatar: string;       // emoji
  description: string;
  location: string;
  rating: number;
  joinedAt: string;
}

export interface Variant {
  id: string;
  name: string;          // 例：黑色 / L
  price: number;         // 售價
  originalPrice?: number; // 原價（選填，用來顯示折扣）；每個規格可各自不同
  stock: number;
}

export interface Product {
  id: string;
  shopId: string;
  title: string;
  description: string;
  categoryId: CategoryId;
  images: string[];     // http(s) URL、data URL，或 "art:🎧:#hex:#hex" 示範插圖
  variants: Variant[];
  sold: number;
  rating: number;
  location: string;
  freeShipping: boolean;
  status: 'active' | 'hidden';
  createdAt: string;
}

export interface CartItem {
  productId: string;
  variantId: string;
  qty: number;
}

export type OrderStatus = 'to_ship' | 'shipping' | 'completed' | 'cancelled';

export interface OrderLine {
  productId: string;
  variantId: string;
  title: string;
  variantName: string;
  image: string;
  price: number;
  qty: number;
}

/** 訂單狀態歷程的一筆事件；狀態一變動資料庫就自動補上 */
export interface OrderEvent {
  status: 'placed' | OrderStatus;
  at: string;
  carrier?: string | null;
  trackingNo?: string | null;
}

export interface Order {
  id: string;
  orderNo: string;      // 好記的訂單編號，如 2610086C04A1E8
  shopId: string;
  lines: OrderLine[];
  shippingFee: number;
  total: number;
  status: OrderStatus;
  buyer: { name: string; phone: string; address: string };
  payment: 'cod' | 'card' | 'transfer';
  carrier?: string | null;    // 物流方式
  trackingNo?: string | null; // 物流單號
  events: OrderEvent[];
  createdAt: string;
}
