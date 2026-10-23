import type { ImportFileKind } from '../../types';

export const MAX_FILE_BYTES = 50 * 1024 * 1024;       // E-1.8（5,000 件的商品描述檔可能超過 10 MB）
export const MAX_PRODUCTS_PER_IMPORT = 5000;           // E-1.7
export const MAX_IMAGES_PER_PRODUCT = 9;               // F-5
export const TITLE_MIN = 5;
export const TITLE_MAX = 60;
export const PRICE_MIN = 1;
export const PRICE_MAX = 499_999;
export const DESCRIPTION_EDITOR_LIMIT = 3000;          // 編輯頁新上限（F-7.5）
export const TOP_UP_PRICE_BELOW = 10;                  // LOOKS_LIKE_TOP_UP
export const TOP_UP_KEYWORDS = ['補差', '補價', '補運'] as const;
export const DEFAULT_VARIANT_NAME = '標準款';
export const FIRST_DATA_ROW_INDEX = 6;                 // 資料從第 7 列開始（0 起算＝6）
export const HEADER_ROW_COUNT = 6;
export const OPTION_SLOTS = 16;
export const EXTRA_IMAGE_SLOTS = 8;

export const KIND_LABEL: Record<ImportFileKind, string> = {
  basic_info: '商品標題及描述',
  sales_info: '價格及庫存',
  media_info: '媒體資訊',
};
export const ALL_KINDS: readonly ImportFileKind[] = ['basic_info', 'sales_info', 'media_info'];

export const KEY = {
  productId: 'et_title_product_id',
  productName: 'et_title_product_name',
  description: 'et_title_product_description',
  variationId: 'et_title_variation_id',
  variationName: 'et_title_variation_name',
  variationPrice: 'et_title_variation_price',
  variationStock: 'et_title_variation_stock',
  category: 'et_title_product_category',
  cover: 'ps_item_cover_image',
  reason: 'et_title_reason',
} as const;

export const imageKey = (n: number) => `ps_item_image.${n}`;
export const optionNameKey = (k: number) => `et_title_option_${k}_for_variation_1`;
export const optionImageKey = (k: number) => `et_title_option_image_${k}_for_variation_1`;

export interface ColumnSpec { key: string; label: string }
const col = (key: string, label: string): ColumnSpec => ({ key, label });
const range = (n: number) => Array.from({ length: n }, (_, i) => i + 1);

/** 各檔必要欄位（F-1 表）；缺任何一個即阻擋（E-1.6） */
export const REQUIRED_COLUMNS: Record<ImportFileKind, ColumnSpec[]> = {
  basic_info: [
    col(KEY.productId, '商品ID'),
    col(KEY.productName, '商品名稱'),
    col(KEY.description, '商品描述'),
  ],
  sales_info: [
    col(KEY.productId, '商品ID'),
    col(KEY.variationId, '商品選項ID'),
    col(KEY.variationName, '商品規格名稱'),
    col(KEY.variationPrice, '價格'),
    col(KEY.variationStock, '庫存'),
  ],
  media_info: [
    col(KEY.productId, '商品ID'),
    col(KEY.category, '商品分類'),
    col(KEY.cover, '主商品圖片'),
    ...range(EXTRA_IMAGE_SLOTS).map((n) => col(imageKey(n), `商品圖片 ${n}`)),
    ...range(OPTION_SLOTS).map((k) => col(optionNameKey(k), `選項 ${k} 的名稱`)),
    ...range(OPTION_SLOTS).map((k) => col(optionImageKey(k), `選項 ${k} 的圖片`)),
  ],
};
