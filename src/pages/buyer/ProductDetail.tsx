import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ChevronRight, MapPin, MessageCircle, ShoppingCart, Star, Store, Truck, X } from 'lucide-react';
import { useStore, FREE_SHIPPING_THRESHOLD, SHIPPING_FEE } from '../../store/StoreContext';
import { useAuth } from '../../store/AuthContext';
import { accountErrorText, toAccountError } from '../../lib/account/errors';
import { autoNoticeText } from '../../lib/auth/autoAction';
import { handoffWhenLoggedIn } from '../../lib/auth/handoff';
import { browserStores, peekPending } from '../../lib/auth/pending';
import Banner from '../../components/import/Banner';
import { btnOutline, btnPrimary } from '../../components/import/ui';
import { useReviews } from '../../store/ReviewsContext';
import ProductReviewsSection from '../../components/reviews/ProductReviewsSection';
import { ratingText } from '../../lib/reviews/format';
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
  const { getProduct, getShop, products, addToCart, user, myShop } = useStore();
  const { openLogin, runPendingOnLoad, loginError, autoNotice, setAutoNotice, handoff, clearHandoff } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const { productStat, shopStat, summaryState } = useReviews();
  const product = getProduct(id);

  const [imgIdx, setImgIdx] = useState(0);
  // 主圖來源只有兩種：圖庫（imgIdx）或規格圖。以「最後一次使用者動作」為準：
  // 選規格 → 規格圖；點縮圖 → 圖庫。程式預選單一規格不算使用者動作，所以預設是圖庫。
  const [showVariantImage, setShowVariantImage] = useState(false);
  // 登入是整頁跳轉，回來時頁面重新載入：待辦動作裡存了登入前選的規格與數量，這裡還原（AC-2）。
  // 只在「剛登入回來」或「登入失敗重開面板」時還原，平常開商品頁不受舊紀錄影響
  // 網址帶來的選擇（LINE 外開接續）也只是預填：規格與數量帶入，但不會自動動作（B-2）
  const [restored] = useState(() => {
    const own = runPendingOnLoad || loginError ? peekPending(browserStores(), Date.now())?.action : null;
    const a = own ?? handoff;
    if (!a || (a.kind !== 'add_to_cart' && a.kind !== 'buy_now') || a.productId !== id) return null;
    const v = product?.variants.find(x => x.id === a.variantId);
    return v ? { variantId: v.id, qty: Math.min(a.qty, Math.max(1, v.stock)) } : null;
  });
  const [variantId, setVariantId] = useState<string | null>(
    restored?.variantId ?? (product?.variants.length === 1 ? product.variants[0].id : null),
  );
  const [qty, setQty] = useState(restored?.qty ?? 1);
  const [sheet, setSheet] = useState<null | 'cart' | 'buy'>(null);
  const [needPick, setNeedPick] = useState(false);

  const related = useMemo(
    () => products.filter(p => p.id !== id && p.status === 'active' && p.categoryId === product?.categoryId).slice(0, 6),
    [products, id, product?.categoryId],
  );

  if (!product || product.status !== 'active') {
    return (
      <div className="mx-auto max-w-6xl p-3 md:p-6">
        <AutoNoticeBanner productId={id} />
        <EmptyState icon="📦" title="商品不存在或已下架" action={<Link to="/" className="text-brand">回首頁</Link>} />
      </div>
    );
  }

  const shop = getShop(product.shopId);
  const variant = product.variants.find(v => v.id === variantId);
  const shown = variant ?? cheapestVariant(product.variants); // 未選規格時以最低價那個為準
  const discount = discountOf(shown);
  const stock = variant ? variant.stock : product.variants.reduce((s, v) => s + v.stock, 0);
  // 選到有規格圖的規格就顯示規格圖；沒有規格圖就退回圖庫（最後點選的縮圖），主圖區不會空白、
  // 也不會停在上一個規格的圖（F-7.1）
  const variantImage = showVariantImage ? variant?.image : undefined;
  const mainSrc = variantImage ?? product.images[imgIdx] ?? product.images[0];
  const mainAlt = variantImage && variant ? `${product.title}（${variant.name}）` : product.title;
  const pickThumb = (i: number) => { setImgIdx(i); setShowVariantImage(false); };
  const category = CATEGORIES.find(c => c.id === product.categoryId);
  const stat = productStat(product.id);
  const shopRating = shopStat(product.shopId);
  const goReviews = () => {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    document.getElementById('reviews')?.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth' });
  };

  // 賣家不能買自己商店的商品（D12）：常駐說明，按鈕不可按但仍可聚焦（aria-disabled，不用 disabled）
  const ownShop = Boolean(myShop) && myShop?.id === product.shopId;
  const confirmHandoff = user && !ownShop && handoff && (handoff.kind === 'add_to_cart' || handoff.kind === 'buy_now')
    && handoff.productId === product.id && handoffWhenLoggedIn(handoff) === 'confirm' ? handoff : null;

  // pick：確認連結帶來的選擇時，照橫幅上寫的規格與數量做（使用者在橫幅出現後改了下面的選擇，也不能讓「確認」變成別的內容）
  const act = (mode: 'cart' | 'buy', pick?: { variantId: string; qty: number }) => {
    const chosen = pick ? product.variants.find(x => x.id === pick.variantId) : variant;
    const chosenQty = pick ? pick.qty : qty;
    // 自己店的商品：不管有沒有選規格，一按就說（不用等選完規格才發現不能買，B-6）
    if (ownShop) {
      toast('不能購買自己商店的商品', 'error');
      return false;
    }
    if (!chosen) {
      setNeedPick(true);
      return false;
    }
    if (chosen.stock === 0) return false;
    const trigger = { kind: mode === 'cart' ? 'add_to_cart' : 'buy_now', productId: product.id, variantId: chosen.id, qty: chosenQty } as const;
    // 遊客只能瀏覽：加入購物車、直接購買都要先登入，登入完回到這個商品頁並自動完成（D14）
    if (!user) {
      openLogin({ trigger });
      return false;
    }
    if (mode === 'cart') {
      void (async () => {
        try {
          await addToCart({ productId: product.id, variantId: chosen.id, qty: chosenQty });
          setAutoNotice(null);
          toast('已加入購物車');
        } catch (e) {
          // 登入在這段時間失效：當作沒登入，開面板（待辦動作會在按下登入時存起來）
          if (toAccountError(e).kind === 'auth') openLogin({ trigger });
          else toast(accountErrorText(e, '加入購物車失敗，請再試一次'), 'error');
        }
      })();
    } else {
      navigate('/checkout', { state: { items: [{ productId: product.id, variantId: chosen.id, qty: chosenQty }], fromCart: false } });
    }
    return true;
  };

  const picker = (
    <VariantPicker
      product={product}
      variantId={variantId}
      onPick={vid => { setVariantId(vid); setShowVariantImage(true); setNeedPick(false); setQty(1); }}
      qty={qty}
      setQty={setQty}
      stock={stock}
      needPick={needPick}
    />
  );

  return (
    <div className="mx-auto max-w-6xl pb-24 md:px-4 md:pb-0 md:pt-4">
      <AutoNoticeBanner productId={product.id} />
      {/* 已登入的人打開帶選擇的連結：不自動動作，問一次（連結是任何人都能散布的） */}
      {confirmHandoff && restored && (
        <div className="px-3 pt-2 md:px-0">
          <Banner
            kind="info" role="status"
            title={confirmHandoff.kind === 'add_to_cart' ? '要加入購物車嗎？' : '要前往結帳嗎？'}
            actions={
              <>
                <button type="button" className={btnPrimary} onClick={() => { const m = confirmHandoff.kind === 'add_to_cart' ? 'cart' : 'buy'; clearHandoff(); act(m, restored); }}>
                  {confirmHandoff.kind === 'add_to_cart' ? '加入購物車' : '直接購買'}
                </button>
                <button type="button" className={btnOutline} onClick={clearHandoff}>不用了</button>
              </>
            }
          >
            這個連結帶了選擇：{product.variants.find(v => v.id === restored.variantId)?.name}　數量 {restored.qty}。確認後才會執行。
          </Banner>
        </div>
      )}
      {/* 登入回來被擋的那則提示（上方 AutoNoticeBanner）已經說明是自己的店，顯示期間不再疊一個常駐說明；按「知道了」後才換成常駐的 */}
      {ownShop && !(autoNotice?.productId === product.id && autoNotice.reason === 'own_shop') && (
        <div className="px-3 pt-2 md:px-0">
          <Banner kind="info" title="這是你自己商店的商品">賣家不能購買自己商店的商品。</Banner>
        </div>
      )}
      <nav className="hidden items-center gap-1 py-2 text-sm text-muted md:flex">
        <Link to="/" className="text-[#0055aa]">好物集</Link>
        <ChevronRight size={14} />
        <Link to={`/search?cat=${product.categoryId}`} className="text-[#0055aa]">{category?.name}</Link>
        <ChevronRight size={14} />
        <span className="truncate">{product.title}</span>
      </nav>

      <section className="grid grid-cols-[minmax(0,1fr)] gap-0 bg-white md:grid-cols-[450px_1fr] md:gap-8 md:rounded-md md:p-5">
        {/* 圖片：min-w-0 讓手機的縮圖橫捲列不會把整頁撐寬 */}
        <div className="min-w-0">
          <div className="relative">
            <ProductImage
              src={mainSrc}
              alt={mainAlt}
              size="lg"
              className="w-full"
              onError={variantImage ? () => setShowVariantImage(false) : undefined}
            />
            {variantImage && variant && (
              <span className="absolute bottom-2 left-2 flex max-w-[calc(100%-1rem)] items-center gap-1.5 rounded-sm bg-ink/75 px-2 py-1 text-xs text-white">
                <span className="shrink-0 font-medium">規格圖</span>
                <span className="truncate">{variant.name}</span>
              </span>
            )}
          </div>
          <p role="status" className="sr-only">{variantImage && variant ? `已切換為規格圖：${variant.name}` : ''}</p>
          {product.images.length > 1 && (
            <div className="no-scrollbar mt-2 flex gap-2 overflow-x-auto px-3 md:grid md:grid-cols-5 md:overflow-visible md:px-0">
              {product.images.map((img, i) => {
                const selected = !variantImage && i === imgIdx;
                return (
                  <button
                    key={i}
                    onMouseEnter={() => pickThumb(i)}
                    onClick={e => {
                      pickThumb(i);
                      e.currentTarget.scrollIntoView({ inline: 'nearest', block: 'nearest' });
                    }}
                    aria-label={`第 ${i + 1} 張圖，共 ${product.images.length} 張`}
                    aria-current={selected ? 'true' : undefined}
                    className={`h-14 w-14 shrink-0 overflow-hidden rounded-sm border-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 md:h-auto md:w-full ${selected ? 'border-brand' : 'border-transparent'}`}
                  >
                    <ProductImage src={img} alt="" size="sm" className="h-full w-full" />
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* 資訊 */}
        <div className="px-3 py-3 md:px-0 md:py-0">
          <h1 className="text-lg leading-snug md:text-xl">{product.title}</h1>
          <div className="mt-2 flex items-center gap-3 text-sm">
            {/* 評價資料還沒回來或載入失敗時整段不顯示：不能對有評價的商品說「尚無評價」 */}
            {stat ? (
              <>
                <button
                  type="button" onClick={goReviews}
                  className="-my-3 inline-flex min-h-11 items-center gap-1.5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
                >
                  <span className="flex items-center gap-1 font-medium">{ratingText(stat.avg)}<Star size={14} className="fill-star text-star" aria-hidden="true" /></span>
                  <span className="underline underline-offset-2">{stat.count} 則評價</span>
                </button>
                <span className="h-4 w-px bg-line" />
              </>
            ) : summaryState === 'ready' && (
              <>
                <span className="text-muted">尚無評價</span>
                <span className="h-4 w-px bg-line" />
              </>
            )}
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
              <span className="rounded-sm bg-brand-dark px-1.5 py-0.5 text-xs font-semibold text-white">
                -{discount}%
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
              aria-disabled={ownShop || undefined}
              className={`flex h-12 items-center gap-2 rounded-sm border px-6 transition disabled:border-line disabled:bg-canvas disabled:text-disabled ${ownShop ? 'border-line bg-canvas text-disabled' : 'border-brand bg-brand-soft text-brand hover:bg-[#ffe6dc]'}`}
            >
              <ShoppingCart size={20} /> 加入購物車
            </button>
            <button
              onClick={() => act('buy')}
              disabled={stock === 0}
              aria-disabled={ownShop || undefined}
              className={`h-12 min-w-44 rounded-sm px-6 text-white transition disabled:bg-disabled ${ownShop ? 'bg-disabled' : 'bg-brand hover:bg-brand-dark'}`}
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
            <p className="break-words text-xs text-muted">
              {shop.location}{shopRating ? `・評價 ${ratingText(shopRating.avg)}` : summaryState === 'ready' ? '・尚無評價' : ''}
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
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

      <ProductReviewsSection productId={product.id} />

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
          onClick={() => (ownShop ? toast('不能購買自己商店的商品', 'error') : setSheet('cart'))}
          disabled={stock === 0}
          aria-disabled={ownShop || undefined}
          className={`flex flex-1 flex-col items-center justify-center py-2 text-[11px] text-white disabled:bg-disabled ${ownShop ? 'bg-disabled' : 'bg-success'}`}
        >
          <ShoppingCart size={20} /> 加入購物車
        </button>
        <button onClick={() => (ownShop ? toast('不能購買自己商店的商品', 'error') : setSheet('buy'))} disabled={stock === 0} aria-disabled={ownShop || undefined} className={`flex-1 py-3.5 text-sm text-white disabled:bg-disabled ${ownShop ? 'bg-disabled' : 'bg-brand'}`}>
          {stock === 0 ? '已售完' : '直接購買'}
        </button>
      </div>

      {sheet && (
        <div className="fixed inset-0 z-50 md:hidden" role="dialog" aria-modal="true">
          <div className="animate-fade absolute inset-0 bg-black/45" onClick={() => setSheet(null)} />
          <div className="animate-sheet pb-safe absolute inset-x-0 bottom-0 max-h-[80dvh] overflow-y-auto rounded-t-2xl bg-white">
            <div className="flex gap-3 border-b border-line p-4">
              <ProductImage src={variant?.image ?? product.images[0]} alt="" size="sm" className="w-20 rounded-md border border-line" />
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
              className={`relative min-w-20 max-w-full break-words rounded-sm border px-3 py-1.5 text-left text-sm transition disabled:cursor-not-allowed disabled:border-dashed disabled:text-disabled ${
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

/** S-4：登入回來後，自動動作沒完成的原因。不搶焦點；登入完成的回饋用 status，失敗才用 alert */
function AutoNoticeBanner({ productId }: { productId: string }) {
  const { autoNotice, setAutoNotice } = useAuth();
  if (!autoNotice || autoNotice.productId !== productId) return null;
  const t = autoNoticeText(autoNotice.mode, autoNotice.reason, autoNotice.detail);
  const dismiss = () => setAutoNotice(null);
  return (
    <div className="px-3 pt-2 md:px-0">
      <Banner
        kind={t.kind} title={t.title} role={t.kind === 'error' ? 'alert' : 'status'}
        actions={
          <>
            {autoNotice.retry && (
              <button type="button" className={btnPrimary} onClick={() => { const r = autoNotice.retry; dismiss(); r?.(); }}>再試一次</button>
            )}
            <button type="button" className={btnOutline} onClick={dismiss}>知道了</button>
          </>
        }
      >
        {t.body}
      </Banner>
    </div>
  );
}
