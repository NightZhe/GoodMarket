import type { Product } from '../types';
import { cheapestVariant } from '../lib/format';
import { cardLabel } from '../lib/products/cardLabel';
import { useStore } from '../store/StoreContext';

/** 商品卡與列表列共用的顯示資料：最低價規格、店名、是否售完、整張連結的 aria-label */
export function useProductView(product: Product) {
  const shopName = useStore().getShop(product.shopId)?.name;
  const cheapest = cheapestVariant(product.variants);
  const price = cheapest?.price ?? 0;
  const originalPrice = cheapest?.originalPrice && cheapest.originalPrice > price ? cheapest.originalPrice : undefined;
  const soldOut = product.variants.every(v => v.stock === 0);
  const label = cardLabel({
    title: product.title, price, originalPrice, sold: product.sold, shopName, location: product.location, soldOut,
  });
  return { shopName, price, originalPrice, soldOut, label, shopLine: [shopName, product.location].filter(Boolean).join('・') };
}
