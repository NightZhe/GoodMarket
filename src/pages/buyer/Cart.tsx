import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Store, Trash2 } from 'lucide-react';
import { useStore } from '../../store/StoreContext';
import ProductImage from '../../components/ProductImage';
import QtyStepper from '../../components/QtyStepper';
import EmptyState from '../../components/EmptyState';
import { money } from '../../lib/format';
import type { CartItem } from '../../types';

const keyOf = (c: Pick<CartItem, 'productId' | 'variantId'>) => `${c.productId}|${c.variantId}`;

export default function Cart() {
  const { cart, getProduct, getShop, setCartQty, removeFromCart } = useStore();
  const navigate = useNavigate();
  const [selected, setSelected] = useState<Set<string>>(() => new Set(cart.map(keyOf)));

  // 依商店分組，並帶出商品與規格資料
  const groups = useMemo(() => {
    const map = new Map<string, { item: CartItem; title: string; image: string; variantName: string; price: number; stock: number }[]>();
    for (const item of cart) {
      const p = getProduct(item.productId);
      const v = p?.variants.find(x => x.id === item.variantId);
      if (!p || !v) continue;
      const rows = map.get(p.shopId) ?? [];
      rows.push({ item, title: p.title, image: p.images[0], variantName: v.name, price: v.price, stock: v.stock });
      map.set(p.shopId, rows);
    }
    return [...map.entries()];
  }, [cart, getProduct]);

  const allRows = groups.flatMap(([, rows]) => rows);
  const chosen = allRows.filter(r => selected.has(keyOf(r.item)) && r.stock > 0);
  const total = chosen.reduce((s, r) => s + r.price * r.item.qty, 0);
  const count = chosen.reduce((s, r) => s + r.item.qty, 0);

  const toggle = (keys: string[], on: boolean) =>
    setSelected(prev => {
      const next = new Set(prev);
      keys.forEach(k => (on ? next.add(k) : next.delete(k)));
      return next;
    });

  if (allRows.length === 0) {
    return (
      <div className="mx-auto max-w-6xl p-3 md:p-6">
        <EmptyState icon="🛒" title="購物車還是空的" action={
          <Link to="/" className="rounded-sm bg-brand px-8 py-2.5 text-white">去逛逛</Link>
        } />
      </div>
    );
  }

  const allKeys = allRows.map(r => keyOf(r.item));
  const allOn = allKeys.every(k => selected.has(k));

  return (
    <div className="mx-auto max-w-6xl pb-28 md:px-4 md:pt-6">
      <h1 className="hidden text-xl font-medium md:block">購物車</h1>
      <div className="space-y-2 md:mt-4 md:space-y-4">
        {groups.map(([shopId, rows]) => {
          const shop = getShop(shopId);
          const keys = rows.map(r => keyOf(r.item));
          return (
            <section key={shopId} className="bg-white md:rounded-md">
              <header className="flex items-center gap-3 border-b border-line px-4 py-3">
                <input type="checkbox" aria-label="全選此商店" className="h-4 w-4 accent-brand" checked={keys.every(k => selected.has(k))} onChange={e => toggle(keys, e.target.checked)} />
                <Link to={`/shop/${shopId}`} className="flex items-center gap-1.5 text-sm font-medium">
                  <Store size={16} /> {shop?.name}
                </Link>
              </header>
              {rows.map(r => (
                <div key={keyOf(r.item)} className="flex items-center gap-3 border-b border-line px-4 py-4 last:border-0">
                  <input type="checkbox" aria-label="選取" className="h-4 w-4 shrink-0 accent-brand" disabled={r.stock === 0}
                    checked={selected.has(keyOf(r.item)) && r.stock > 0} onChange={e => toggle([keyOf(r.item)], e.target.checked)} />
                  <Link to={`/product/${r.item.productId}`} className="w-20 shrink-0 overflow-hidden rounded-sm border border-line">
                    <ProductImage src={r.image} alt={r.title} size="sm" className="w-full" />
                  </Link>
                  <div className="min-w-0 flex-1 md:grid md:grid-cols-[1fr_120px_140px_110px_50px] md:items-center md:gap-4">
                    <div className="min-w-0">
                      <p className="line-clamp-2 text-sm">{r.title}</p>
                      <p className="mt-1 w-fit rounded-sm bg-canvas px-1.5 text-xs text-muted">規格：{r.variantName}</p>
                      {r.stock === 0 && <p className="mt-1 text-xs text-red-500">此規格已售完</p>}
                    </div>
                    <p className="mt-1 text-brand md:mt-0 md:text-center md:text-ink">{money(r.price)}</p>
                    <div className="mt-2 flex items-center justify-between md:mt-0 md:justify-center">
                      <QtyStepper value={r.item.qty} max={Math.max(1, r.stock)} onChange={n => setCartQty(r.item.productId, r.item.variantId, n)} />
                      <button onClick={() => removeFromCart([r.item])} aria-label="刪除" className="p-2 text-muted md:hidden"><Trash2 size={18} /></button>
                    </div>
                    <p className="hidden text-center text-brand md:block">{money(r.price * r.item.qty)}</p>
                    <button onClick={() => removeFromCart([r.item])} className="hidden text-sm hover:text-brand md:block">刪除</button>
                  </div>
                </div>
              ))}
            </section>
          );
        })}
      </div>

      <div className="pb-safe fixed inset-x-0 bottom-0 z-30 border-t border-line bg-white md:sticky md:mt-4 md:rounded-md md:shadow-[0_-4px_12px_rgba(0,0,0,0.05)]">
        <div className="mx-auto flex max-w-6xl items-center gap-3 py-2 pl-4 md:py-4 md:pl-6">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" className="h-4 w-4 accent-brand" checked={allOn} onChange={e => toggle(allKeys, e.target.checked)} />
            全選
          </label>
          <button
            onClick={() => { removeFromCart(chosen.map(r => r.item)); }}
            disabled={!chosen.length}
            className="hidden text-sm hover:text-brand disabled:text-gray-300 md:block"
          >
            刪除選取
          </button>
          <div className="ml-auto text-right">
            <p className="text-sm">總金額 <span className="text-lg text-brand md:text-2xl">{money(total)}</span></p>
          </div>
          <button
            disabled={!count}
            onClick={() => navigate('/checkout', { state: { items: chosen.map(r => r.item), fromCart: true } })}
            className="h-12 min-w-28 self-stretch bg-brand px-5 text-white transition hover:bg-brand-dark disabled:bg-gray-300 md:mr-6 md:h-11 md:min-w-52 md:self-auto md:rounded-sm"
          >
            去買單 ({count})
          </button>
        </div>
      </div>
    </div>
  );
}
