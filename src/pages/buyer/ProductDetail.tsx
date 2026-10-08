import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ChevronRight, MapPin, MessageCircle, ShoppingCart, Star, Store, Truck, X } from 'lucide-react';
import { useStore, FREE_SHIPPING_THRESHOLD, SHIPPING_FEE } from '../../store/StoreContext';
import { CATEGORIES } from '../../data/seed';
import ProductImage from '../../components/ProductImage';
import ProductCard from '../../components/ProductCard';
import QtyStepper from '../../components/QtyStepper';
import EmptyState from '../../components/EmptyState';
import { useToast } from '../../components/Toast';
import { cheapestVariant, discountOf, money, priceRange, soldText } from '../../lib/format';
import type { Product } from '../../types';

// 用 key 讓切換到另一個商品時，規格／數量等狀態重新開始
export default function ProductDetail() {
  const { id = '' } = useParams();
  return <ProductDetailView key={id} id={id} />;
}

function ProductDetailView({ id }: { id: string }) {
  const { getProduct, getShop, products, addToCart } = useStore();
  const navigate = useNavigate();
  const toast = useToast();
  const product = getProduct(id);

  const [imgIdx, setImgIdx] = useState(0);
  const [variantId, setVariantId] = useState<string | null>(
    product?.variants.length === 1 ? product.variants[0].id : null,
  );
  const [qty, setQty] = useState(1);
  const [sheet, setSheet] = useState<null | 'cart' | 'buy'>(null);
  const [needPick, setNeedPick] = useState(false);

  const related = useMemo(
    () => products.filter(p => p.id !== id && p.status === 'active' && p.categoryId === product?.categoryId).slice(0, 6),
    [products, id, product?.categoryId],
  );

  if (!product || product.status !== 'active') {
    return (
      <div className="mx-auto max-w-6xl p-3 md:p-6">
        <EmptyState icon="📦" title="商品不存在或已下架" action={<Link to="/" className="text-brand">回首頁</Link>} />
      </div>
    );
  }

  const shop = getShop(product.shopId);
  const variant = product.variants.find(v => v.id === variantId);
  const shown = variant ?? cheapestVariant(product.variants); // 未選規格時以最低價那個為準
  const discount = discountOf(shown);
  const stock = variant ? variant.stock : product.variants.reduce((s, v) => s + v.stock, 0);
  const category = CATEGORIES.find(c => c.id === product.categoryId);

  const act = (mode: 'cart' | 'buy') => {
    if (!variant) {
      setNeedPick(true);
      return false;
    }
    if (variant.stock === 0) return false;
    if (mode === 'cart') {
      addToCart({ productId: product.id, variantId: variant.id, qty });
      toast('已加入購物車');
    } else {
      navigate('/checkout', { state: { items: [{ productId: product.id, variantId: variant.id, qty }], fromCart: false } });
    }
    return true;
  };

  const picker = (
    <VariantPicker
      product={product}
      variantId={variantId}
      onPick={vid => { setVariantId(vid); setNeedPick(false); setQty(1); }}
      qty={qty}
      setQty={setQty}
      stock={stock}
      needPick={needPick}
    />
  );

  return (
    <div className="mx-auto max-w-6xl pb-24 md:px-4 md:pb-0 md:pt-4">
      <nav className="hidden items-center gap-1 py-2 text-sm text-muted md:flex">
        <Link to="/" className="text-[#0055aa]">好物集</Link>
        <ChevronRight size={14} />
        <Link to={`/search?cat=${product.categoryId}`} className="text-[#0055aa]">{category?.name}</Link>
        <ChevronRight size={14} />
        <span className="truncate">{product.title}</span>
      </nav>

      <section className="grid gap-0 bg-white md:grid-cols-[450px_1fr] md:gap-8 md:rounded-md md:p-5">
        {/* 圖片 */}
        <div>
          <ProductImage src={product.images[imgIdx] ?? product.images[0]} alt={product.title} size="lg" className="w-full" />
          {product.images.length > 1 && (
            <div className="mt-2 flex gap-2 px-3 md:px-0">
              {product.images.map((img, i) => (
                <button
                  key={i}
                  onMouseEnter={() => setImgIdx(i)}
                  onClick={() => setImgIdx(i)}
                  aria-label={`第 ${i + 1} 張圖`}
                  className={`w-16 overflow-hidden rounded-sm border-2 md:w-20 ${i === imgIdx ? 'border-brand' : 'border-transparent'}`}
                >
                  <ProductImage src={img} alt="" size="sm" className="w-full" />
                </button>
              ))}
            </div>
          )}
        </div>

        {/* 資訊 */}
        <div className="px-3 py-3 md:px-0 md:py-0">
          <h1 className="text-lg leading-snug md:text-xl">{product.title}</h1>
          <div className="mt-2 flex items-center gap-3 text-sm">
            <span className="flex items-center gap-1 text-brand">
              <span className="underline underline-offset-2">{product.rating.toFixed(1)}</span>
              <Star size={14} className="fill-brand" />
            </span>
            <span className="h-4 w-px bg-line" />
            <span><span className="underline underline-offset-2">{soldText(product.sold)}</span> <span className="text-muted">已售出</span></span>
          </div>

          {/* 原價與折扣都跟著規格走：選了規格看該規格的，沒選就看最低價那個 */}
          <div className="mt-3 flex flex-wrap items-center gap-3 bg-[#fafafa] px-4 py-4 md:mt-4">
            {shown?.originalPrice && discount > 0 && (
              <span className="text-muted line-through">{money(shown.originalPrice)}</span>
            )}
            <span className="text-3xl font-medium text-brand">
              {variant ? money(variant.price) : priceRange(product.variants.map(v => v.price))}
            </span>
            {discount > 0 && (
              <span className="rounded-sm bg-brand px-1 text-xs font-semibold text-white">
                {discount}% 折扣
              </span>
            )}
          </div>

          <dl className="mt-4 space-y-4 text-sm md:space-y-6">
            <div className="flex gap-4">
              <dt className="w-20 shrink-0 text-muted">運送</dt>
              <dd className="space-y-1">
                <p className="flex items-center gap-1.5">
                  <Truck size={16} className="text-success" />
                  {product.freeShipping ? <span className="text-success">免運費</span> : <>運費 {money(SHIPPING_FEE)}・同店滿 {money(FREE_SHIPPING_THRESHOLD)} 免運</>}
                </p>
                <p className="flex items-center gap-1.5 text-muted"><MapPin size={16} /> 從 {product.location} 出貨</p>
              </dd>
            </div>
            <div className="hidden md:block">{picker}</div>
          </dl>

          <div className="mt-8 hidden gap-3 md:flex">
            <button
              onClick={() => act('cart')}
              disabled={stock === 0}
              className="flex h-12 items-center gap-2 rounded-sm border border-brand bg-brand-soft px-6 text-brand transition hover:bg-[#ffe6dc] disabled:border-line disabled:bg-canvas disabled:text-disabled"
            >
              <ShoppingCart size={20} /> 加入購物車
            </button>
            <button
              onClick={() => act('buy')}
              disabled={stock === 0}
              className="h-12 min-w-44 rounded-sm bg-brand px-6 text-white transition hover:bg-brand-dark disabled:bg-disabled"
            >
              {stock === 0 ? '已售完' : '直接購買'}
            </button>
          </div>
        </div>
      </section>

      {/* 商店 */}
      {shop && (
        <section className="mt-2 flex items-center gap-4 bg-white p-4 md:mt-4 md:rounded-md md:p-6">
          <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full border border-line bg-canvas text-3xl md:h-20 md:w-20 md:text-5xl">
            {shop.avatar}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate font-medium">{shop.name}</p>
            <p className="truncate text-xs text-muted">{shop.location}・評價 {shop.rating.toFixed(1)}</p>
            <div className="mt-2 flex gap-2">
              <button onClick={() => toast('示範版尚未開放聊聊')} className="flex items-center gap-1 rounded-sm border border-brand bg-brand-soft px-3 py-1 text-xs text-brand">
                <MessageCircle size={14} /> 聊聊
              </button>
              <Link to={`/shop/${shop.id}`} className="flex items-center gap-1 rounded-sm border border-line px-3 py-1 text-xs">
                <Store size={14} /> 逛賣場
              </Link>
            </div>
          </div>
        </section>
      )}

      <section className="mt-2 bg-white p-4 md:mt-4 md:rounded-md md:p-6">
        <h2 className="bg-[#fafafa] px-3 py-2.5 text-base font-medium">商品詳情</h2>
        <p className="mt-4 whitespace-pre-line px-1 text-sm leading-7">{product.description}</p>
      </section>

      {related.length > 0 && (
        <section className="mt-2 md:mt-4">
          <h2 className="px-3 py-3 text-sm font-medium uppercase text-muted md:px-0">同類商品推薦</h2>
          <div className="grid grid-cols-2 gap-2 px-2 sm:grid-cols-3 md:grid-cols-6 md:px-0">
            {related.map(p => <ProductCard key={p.id} product={p} />)}
          </div>
        </section>
      )}

      {/* 手機底部操作列 */}
      <div className="pb-safe fixed inset-x-0 bottom-0 z-40 flex bg-white shadow-sheet md:hidden">
        <Link to="/" className="flex w-20 flex-col items-center justify-center text-[10px] text-success-text">
          <Store size={20} /> 首頁
        </Link>
        <button
          onClick={() => setSheet('cart')}
          disabled={stock === 0}
          className="flex flex-1 flex-col items-center justify-center bg-success py-2 text-[11px] text-white disabled:bg-disabled"
        >
          <ShoppingCart size={20} /> 加入購物車
        </button>
        <button onClick={() => setSheet('buy')} disabled={stock === 0} className="flex-1 bg-brand py-3.5 text-sm text-white disabled:bg-disabled">
          {stock === 0 ? '已售完' : '直接購買'}
        </button>
      </div>

      {sheet && (
        <div className="fixed inset-0 z-50 md:hidden" role="dialog" aria-modal="true">
          <div className="animate-fade absolute inset-0 bg-black/45" onClick={() => setSheet(null)} />
          <div className="animate-sheet pb-safe absolute inset-x-0 bottom-0 max-h-[80dvh] overflow-y-auto rounded-t-2xl bg-white">
            <div className="flex gap-3 border-b border-line p-4">
              <ProductImage src={product.images[0]} alt="" size="sm" className="w-20 rounded-md border border-line" />
              <div className="flex flex-1 flex-col justify-end">
                <p className="flex items-baseline gap-2">
                  <span className="text-xl text-brand">{variant ? money(variant.price) : priceRange(product.variants.map(v => v.price))}</span>
                  {shown?.originalPrice && discount > 0 && (
                    <span className="text-sm text-muted line-through">{money(shown.originalPrice)}</span>
                  )}
                </p>
                <p className="text-xs text-muted">庫存 {stock}</p>
              </div>
              <button onClick={() => setSheet(null)} aria-label="關閉" className="self-start p-1 text-muted"><X size={22} /></button>
            </div>
            <div className="p-4">{picker}</div>
            <button
              onClick={() => { if (act(sheet)) setSheet(null); }}
              className="m-4 mt-2 h-12 w-[calc(100%-2rem)] rounded-sm bg-brand text-white"
            >
              {sheet === 'cart' ? '加入購物車' : '直接購買'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function VariantPicker(props: {
  product: Product; variantId: string | null; onPick: (id: string) => void;
  qty: number; setQty: (n: number) => void; stock: number; needPick: boolean;
}) {
  const { product, variantId, onPick, qty, setQty, stock, needPick } = props;
  return (
    <div className={`space-y-5 rounded-sm ${needPick ? 'bg-error-bg p-3 ring-1 ring-error-border' : ''}`}>
      <div className="flex flex-col gap-2 md:flex-row md:gap-4">
        <span className="w-20 shrink-0 pt-1.5 text-sm text-muted">規格</span>
        <div className="flex flex-wrap gap-2">
          {product.variants.map(v => (
            <button
              key={v.id}
              disabled={v.stock === 0}
              onClick={() => onPick(v.id)}
              className={`relative min-w-20 rounded-sm border px-3 py-1.5 text-sm transition disabled:cursor-not-allowed disabled:border-dashed disabled:text-disabled ${
                v.id === variantId ? 'border-brand text-brand' : 'border-line hover:border-brand hover:text-brand'
              }`}
            >
              <span>{v.name}</span>
              <span className="ml-1.5 text-xs text-muted">{money(v.price)}</span>
              {v.id === variantId && <span className="absolute bottom-0 right-0 h-0 w-0 border-b-[10px] border-l-[10px] border-b-brand border-l-transparent" />}
            </button>
          ))}
        </div>
      </div>
      <div className="flex items-center gap-4">
        <span className="w-20 shrink-0 text-sm text-muted">數量</span>
        <QtyStepper value={qty} max={Math.max(1, stock)} onChange={setQty} />
        <span className="text-sm text-muted">還剩 {stock} 件</span>
      </div>
      {needPick && <p className="text-sm text-error">請先選擇規格</p>}
    </div>
  );
}
