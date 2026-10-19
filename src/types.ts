// 領域模型：之後接真後端（Spring Boot / Node）時，這些型別就是 API 契約的起點

export type CategoryId =
  | 'women' | 'men' | 'beauty' | '3c' | 'home' | 'food' | 'sports' | 'baby'
  | 'games' | 'toys' | 'other';

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
  sourceId?: string;     // 匯入來源的規格 ID（字串）；手動建立的規格沒有
  image?: string;        // 規格圖（已轉存的好物集網址）；沒有則商品頁維持商品圖
}

/** 商品來源；手動建立的商品沒有 */
export type ProductSource = 'shopee';

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
  source?: ProductSource;   // 匯入來源；手動建立的商品沒有
  sourceProductId?: string; // 來源平台的商品 ID（字串，不轉數字）
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
export type ShippingMilestone =
  | 'handed_over'      // 賣家已寄件成功
  | 'in_transit'       // 包裹送往物流中心
  | 'out_for_delivery' // 包裹配送中
  | 'arrived_store'    // 已送達門市，待取貨
  | 'picked_up';       // 買家已取貨

export interface OrderEvent {
  status: 'placed' | OrderStatus | ShippingMilestone;
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
  payment: 'cod' | 'card' | 'transfer' | 'ecpay_card';
  carrier?: string | null;    // 物流方式
  trackingNo?: string | null; // 物流單號
  events: OrderEvent[];
  createdAt: string;
}

// ───────── 蝦皮匯入契約（對應 .work 規格 6.0；由 supabase 的 rpc 實作）─────────

/** 已轉存的圖片：url＝好物集 Storage 網址，sourceUrl＝來源（蝦皮）原網址 */
export interface ImageRef {
  url: string;
  sourceUrl: string;
}

export type ImportFileKind = 'basic_info' | 'sales_info' | 'media_info';

export interface ImportItemVariant {
  sourceVariantId: string;  // /^\d{1,20}$/，同商品內不重複
  name: string;             // 非空，同商品內不重複
  price: number;            // 整數 1–499,999
  stock: number;            // 整數 ≥ 0
  image: ImageRef | null;
}

export interface ImportItem {
  sourceProductId: string;  // /^\d{1,20}$/
  title: string;            // 5–60 字（code point）
  description: string;      // 不設上限
  categoryId: CategoryId;
  status: 'active' | 'hidden'; // 只在新增時採用；更新時由資料庫決定
  images: ImageRef[];       // 1–9；順序即顯示順序
  variants: ImportItemVariant[]; // ≥ 1
}

export interface ImportStartMeta {
  externalShopId: string;
  files: { kind: ImportFileKind; fileName: string }[];
  totalProducts: number;    // X + Y，1–500
  skipped: number;          // 因「略過已售完」不送的件數
  options: { skipSoldOut: boolean; allHidden: boolean };
}

/** 呼叫層錯誤碼（error.hint） */
export type ImportCallErrorCode =
  | 'NOT_AUTHENTICATED' | 'NO_SHOP' | 'INVALID_PAYLOAD' | 'IMPORT_LIMIT_EXCEEDED'
  | 'BATCH_TOO_LARGE' | 'IMPORT_NOT_FOUND' | 'IMPORT_CLOSED';

/** 單件錯誤碼（results[].errors[].code）；DESCRIPTION_TOO_LONG 本版不使用但保留 */
export type ItemErrorCode =
  | 'SOURCE_ID_INVALID' | 'DUPLICATE_IN_BATCH' | 'TITLE_LENGTH' | 'DESCRIPTION_TOO_LONG'
  | 'CATEGORY_INVALID' | 'STATUS_INVALID' | 'IMAGE_COUNT' | 'IMAGE_NOT_TRANSFERRED'
  | 'VARIANT_REQUIRED' | 'VARIANT_NAME_INVALID' | 'VARIANT_NAME_DUPLICATE'
  | 'VARIANT_SOURCE_DUPLICATE' | 'PRICE_INVALID' | 'STOCK_INVALID' | 'INTERNAL';

export interface ImportBatchResult {
  sourceProductId: string;
  outcome: 'created' | 'updated' | 'failed';
  productId: string | null;               // failed 時為 null
  status: 'active' | 'hidden' | null;     // 寫入後的上下架；failed 時為 null
  errors: { code: ItemErrorCode; field: string; message: string }[]; // 非 failed 時為 []
}

export interface ImportClientFailure {
  sourceProductId: string;
  code: string;             // 前端錯誤碼，如 IMAGE_DOWNLOAD_FAILED、MISSING_IN_FILE
  message: string;
}

export interface ImportSkippedImage {
  sourceProductId: string;
  slot: string;             // 'image:1'…'image:8' 或 'option:〈選項名稱〉'
  sourceUrl: string;
  code: 'IMAGE_DOWNLOAD_FAILED' | 'IMAGE_UPLOAD_FAILED';
}

export interface ImportRecord {
  importId: string;
  status: 'running' | 'completed';
  startedAt: string;
  finishedAt: string | null;
  totalProducts: number;
  created: number;
  updated: number;
  failed: number;
  skipped: number;
  skippedImages: number;
}

export interface ImportIndex {
  products: {
    sourceProductId: string;
    productId: string;
    status: 'active' | 'hidden';
    variants: { sourceVariantId: string; variantId: string }[];
  }[];
  images: { sourceUrl: string; url: string }[];
  lastImport: ImportRecord | null;
}

/**
 * 結帳比價：下單被擋時伺服器回傳的一個問題（介面見 .work/checkout-price-check/interface.md）。
 * price＝看到的單價與目前單價不同；stock＝要買的合計數量超過目前庫存（stock 0＝已售完）；
 * shipping＝結帳頁該店顯示的運費與目前運費不同
 */
export type CheckoutRejection =
  | { kind: 'price'; productId: string; variantId: string; shopId: string; title: string; variantName: string; seenPrice: number; currentPrice: number }
  | { kind: 'stock'; productId: string; variantId: string; shopId: string; title: string; variantName: string; qty: number; stock: number }
  | { kind: 'shipping'; shopId: string; shopName: string; seenFee: number; currentFee: number };
