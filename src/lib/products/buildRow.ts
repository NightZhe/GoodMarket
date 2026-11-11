import type { Product, Variant } from '../../types';

/** 寫入 products 的欄位：與資料庫的欄位授權一致（見 supabase/migrations） */
export interface ProductWriteRow {
  shop_id: string;
  title: string;
  description: string;
  category_id: string;
  images: string[];
  variants: Variant[];
  free_shipping: boolean;
  location: string;
  status: Product['status'];
}

/** 規格只送白名單欄位；選填欄位沒有值（undefined／null）就不送 */
export function toVariantPayload(v: Variant): Variant {
  const out: Variant = { id: v.id, name: v.name, price: v.price, stock: v.stock };
  if (typeof v.originalPrice === 'number') out.originalPrice = v.originalPrice;
  if (typeof v.sourceId === 'string') out.sourceId = v.sourceId;
  if (typeof v.image === 'string') out.image = v.image;
  return out;
}

export function buildProductRow(product: Product, shop: { id: string; location: string }): ProductWriteRow {
  return {
    shop_id: shop.id, title: product.title, description: product.description,
    category_id: product.categoryId, images: product.images, variants: product.variants.map(toVariantPayload),
    free_shipping: product.freeShipping,
    location: shop.location, status: product.status,
  };
}
