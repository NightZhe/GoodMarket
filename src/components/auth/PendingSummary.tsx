import { ShoppingCart } from 'lucide-react';
import ProductImage from '../ProductImage';
import { useStore } from '../../store/StoreContext';
import type { PendingInput } from '../../lib/auth/pending';

/**
 * C-2 待辦摘要：登入前先讓使用者看到「我選的東西還在」，以及登入後會發生什麼事（D14）。
 * 不顯示價格（待辦動作不存價格）；讀不到商品就不顯示，不要因此卡住登入。
 */
export default function PendingSummary({ trigger }: { trigger: PendingInput | null }) {
  const { getProduct, getShop } = useStore();
  if (!trigger || trigger.kind === 'goto') return null;

  if (trigger.kind === 'checkout') {
    const shops = new Set(trigger.items.map(i => getProduct(i.productId)?.shopId).filter(Boolean));
    const count = trigger.items.reduce((n, i) => n + i.qty, 0);
    return (
      <div className="rounded-md border border-line bg-subtle p-3">
        <p className="flex items-center gap-1.5 text-xs font-medium"><ShoppingCart size={14} className="text-muted" aria-hidden="true" />登入後會回到結帳頁</p>
        <p className="mt-2 text-sm">{count} 件商品{shops.size > 0 ? `，來自 ${shops.size} 家商店` : ''}</p>
      </div>
    );
  }

  const product = getProduct(trigger.productId);
  const variant = product?.variants.find(v => v.id === trigger.variantId);
  if (!product || !variant) return null;
  const lead = trigger.kind === 'add_to_cart' ? '登入後會自動加入購物車' : '登入後會直接前往結帳';
  const shopName = getShop(product.shopId)?.name;
  return (
    <div className="rounded-md border border-line bg-subtle p-3" role="group" aria-label={`${lead}：${product.title}，規格 ${variant.name}，數量 ${trigger.qty}${shopName ? `，${shopName}` : ''}`}>
      <p className="flex items-center gap-1.5 text-xs font-medium"><ShoppingCart size={14} className="text-muted" aria-hidden="true" />{lead}</p>
      <div className="mt-2 flex gap-3" aria-hidden="true">
        <ProductImage src={variant.image ?? product.images[0]} alt="" size="sm" className="w-12 shrink-0 self-start rounded-sm border border-line" />
        <div className="min-w-0">
          <p className="line-clamp-2 text-sm">{product.title}</p>
          <p className="mt-0.5 text-xs text-muted">規格：{variant.name}　數量：{trigger.qty}</p>
        </div>
      </div>
    </div>
  );
}
