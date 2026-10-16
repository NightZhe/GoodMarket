// 商品評價的資料契約。欄位名稱對應資料庫 RPC 的 jsonb 回傳（snake_case），
// 見 migration 20261016120000_product_reviews.sql；只有送出時的 p_items 用 camelCase。

export const MAX_RATING = 5;
export const MAX_CONTENT = 500;
export const MAX_PHOTOS = 5;
export const NICKNAME_MIN = 2;
export const NICKNAME_MAX = 12;
export const PAGE_SIZE = 20;

/** 資料庫丟出的錯誤碼（error.hint） */
export type ReviewErrorCode =
  | 'ORDER_NOT_FOUND' | 'ORDER_NOT_COMPLETED' | 'REVIEW_EXPIRED' | 'EMPTY_SUBMISSION' | 'ITEM_INVALID'
  | 'PRODUCT_NOT_IN_ORDER' | 'ALREADY_REVIEWED' | 'DUPLICATE_ITEM' | 'RATING_INVALID'
  | 'CONTENT_TOO_LONG' | 'NICKNAME_INVALID' | 'PHOTO_TOO_MANY' | 'PHOTO_INVALID' | 'UPLOAD_EXPIRED'
  | 'UPLOAD_COUNT_INVALID' | 'UPLOAD_LIMIT_EXCEEDED'
  | 'NOT_AUTHENTICATED' | 'NO_SHOP' | 'TAB_INVALID'
  | 'REVIEW_NOT_FOUND' | 'REVIEW_HIDDEN' | 'REPLY_INVALID';

// ───────── 公開統計 ─────────

export interface RatingStat { count: number; avg: number }
export interface ReviewSummaryData {
  products: Record<string, RatingStat>;
  shops: Record<string, RatingStat>;
}

// ───────── 買家自己的評價狀態 ─────────

export interface MyReview {
  id: string;
  rating: number;
  content: string;
  /** 原始暱稱，只有買家本人拿得到 */
  nickname: string | null;
  created_at: string;
  photos: string[];
  seller_reply: string | null;
  seller_replied_at: string | null;
  hidden: boolean;
}

export interface MyReviewItem {
  product_id: string;
  title: string;
  image: string;
  variant_names: string[];
  reviewed: boolean;
  review: MyReview | null;
}

export interface OrderReviewStatus {
  order_id: string;
  order_no: string;
  completed_at: string;
  /** YYYY-MM-DD（台北時間） */
  deadline_date: string;
  deadline_at: string;
  expired: boolean;
  items: MyReviewItem[];
}

export interface UploadSlot { path: string; expires_at: string }

export interface SubmitItem {
  productId: string;
  rating: number;
  content?: string;
  photos?: string[];
}

// ───────── 公開評價列表 ─────────

export interface PublicReview {
  id: string;
  rating: number;
  display_name: string;
  variant_names: string[];
  content: string;
  created_at: string;
  seller_reply: string | null;
  seller_replied_at: string | null;
  photos: string[];
  /** 只有賣場評價列表才有 */
  product_id?: string;
  product_title?: string;
  product_image?: string;
  product_available?: boolean;
}

export interface PublicReviewList {
  total: number;
  with_photos: number;
  counts: Record<'1' | '2' | '3' | '4' | '5', number>;
  filtered_total: number;
  product: { id: string; shop_id: string; title: string; image: string; available: boolean } | null;
  reviews: PublicReview[];
}

// ───────── 賣家端 ─────────

export interface SellerReviewCounts {
  unreplied_count: number;
  review_count: number;
  rating: number | null;
}

export type SellerTab = 'all' | 'unreplied';

export interface SellerReview {
  id: string;
  rating: number;
  display_name: string;
  order_no: string;
  variant_names: string[];
  product_id: string;
  product_title: string;
  product_image: string;
  product_available: boolean;
  content: string;
  created_at: string;
  photos: string[];
  seller_reply: string | null;
  seller_replied_at: string | null;
  hidden: boolean;
}

export interface SellerReviewList {
  tab: SellerTab;
  counts: Record<'all' | '1' | '2' | '3' | '4' | '5', number>;
  total: number;
  reviews: SellerReview[];
}

export interface ReplyResult { id: string; seller_reply: string; seller_replied_at: string }
