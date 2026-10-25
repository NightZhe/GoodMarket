import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ChevronRight, X } from 'lucide-react';
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
import Photo from '../../components/Photo';
import ProductCard from '../../components/ProductCard';
import SectionHeader from '../../components/SectionHeader';
import Shelf from '../../components/Shelf';
import LetterAvatar from '../../components/LetterAvatar';
import QtyStepper from '../../components/QtyStepper';
import EmptyState from '../../components/EmptyState';
import { useToast } from '../../components/Toast';
import { useOnline } from '../../lib/useOnline';
import { cheapestVariant, discountOf, money, priceRange, soldText } from '../../lib/format';
import { reduceMotion } from '../../lib/ui/scroll';
import type { Product } from '../../types';

// 用 key 讓切換到另一個商品時，規格／數量等狀態重新開始
export default function ProductDetail() {
  const { id = '' } = useParams();
  return <ProductDetailView key={id} id={id} />;
}

function ProductDetailView({ id }: { id: string }) {
  const { getProduct, getShop, products, addToCart, user, myShop } = useStore();
  const { openLogin, runPendingOnLoad, flowRestored, loginError, autoNotice, setAutoNotice, handoff, clearHandoff } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const online = useOnline();
  const { productStat, summaryState } = useReviews();
  const product = getProduct(id);

  // 第一張照片只有兩種來源：圖庫或規格圖。使用者選了規格才換成規格圖；
  // 程式預選單一規格不算使用者動作，所以預設是圖庫。
  const [showVariantImage, setShowVariantImage] = useState(false);
  // 登入是整頁跳轉，回來時頁面重新載入：待辦動作裡存了登入前選的規格與數量，這裡還原（AC-2）。
  // 只在「剛登入回來」「登入失敗重開面板」「手機驗證做到一半重新整理」時還原，平常開商品頁不受舊紀錄影響
  // 網址帶來的選擇（LINE 外開接續）也只是預填：規格與數量帶入，但不會自動動作（B-2）
  const [restored] = useState(() => {
    const own = runPendingOnLoad || loginError || flowRestored ? peekPending(browserStores(), Date.now())?.action : null;
    const a = own ?? handoff;
    if (!a || (a.kind !== 'add_to_cart' && a.kind !== 'buy_now') || a.productId !== id) return null;
    const v = product?.variants.find(x => x.id === a.variantId);
    return v ? { variantId: v.id, qty: Math.min(a.qty, Math.max(1, v.stock)) } : null;
  });
  const [variantId, setVariantId] = useState<string | null>(
    restored?.variantId ?? (product?.variants.length === 1 ? product.variants[0].id : null),
  );
  const [qty, setQty] = useState(restored?.qty ?? 1);
  // 'pick'：只選規格（「選擇規格」列打開），按「完成」只關面板，選擇本來就即時套用
  const [sheet, setSheet] = useState<null | 'cart' | 'buy' | 'pick'>(null);
  const [needPick, setNeedPick] = useState(false);
  // 手機驗證不會整頁轉址：登入面板關掉後規格抽屜還開著，待辦動作（加入購物車）已經在背景完成，抽屜要跟著收起來
  const signedIn = user !== null;
  useEffect(() => { if (signedIn) setSheet(null); }, [signedIn]);

  const related = useMemo(
    () => products.filter(p => p.id !== id && p.status === 'active' && p.categoryId === product?.categoryId).slice(0, 10),
    [products, id, product?.categoryId],
  );

  if (!product || product.status !== 'active') {
    return (
      <div className="mx-auto max-w-6xl p-3 md:p-6">
        <AutoNoticeBanner productId={id} />
        <EmptyState title="這件商品已下架或不存在" action={<Link to="/" className={`${PILL} h-11 bg-canvas px-6 text-brand ${PRESS} active:bg-press`}>回首頁</Link>} />
      </div>
    );
  }

  const shop = getShop(product.shopId);
  const variant = product.variants.find(v => v.id === variantId);
  const shown = variant ?? cheapestVariant(product.variants); // 未選規格時以最低價那個為準
  const discount = discountOf(shown);
  const stock = variant ? variant.stock : product.variants.reduce((s, v) => s + v.stock, 0);
  // 選到有規格圖的規格就把第一張換成規格圖；沒有規格圖就維持圖庫，照片區不會空白、
  // 也不會停在上一個規格的圖（F-7.1）
  const variantImage = showVariantImage ? variant?.image : undefined;
  const slides = variantImage ? [variantImage, ...product.images.slice(1)] : product.images;
  const category = CATEGORIES.find(c => c.id === product.categoryId);
  const stat = productStat(product.id);
  const goReviews = () => {
    document.getElementById('reviews')?.scrollIntoView({ behavior: reduceMotion() ? 'auto' : 'smooth' });
  };

  // 賣家不能買自己商店的商品（D12）：常駐說明，按鈕不可按但仍可聚焦（aria-disabled，不用 disabled）
  const ownShop = Boolean(myShop) && myShop?.id === product.shopId;
  const confirmHandoff = user && !ownShop && handoff && (handoff.kind === 'add_to_cart' || handoff.kind === 'buy_now')
    && handoff.productId === product.id && handoffWhenLoggedIn(handoff) === 'confirm' ? handoff : null;
  // 購買鈕擋下的情況：自己的商品、離線。按鈕仍可聚焦（aria-disabled），按下說明原因
  const blocked = () => {
    if (ownShop) { toast('不能購買自己商店的商品', 'error'); return true; }
    if (!online) { toast('連上網路後才能購買', 'info'); return true; }
    return false;
  };
  const dimmed = ownShop || !online;

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
    <div className="mx-auto max-w-6xl md:px-4 md:pt-4">
      <AutoNoticeBanner productId={product.id} />
      {/* 已登入的人打開帶選擇的連結：不自動動作，問一次（連結是任何人都能散布的） */}
      {confirmHandoff && restored && (
        <div className="px-5 pt-2 md:px-0">
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
        <div className="px-5 pt-2 md:px-0">
          <Banner kind="info" title="這是你自己商店的商品">賣家不能購買自己商店的商品。</Banner>
        </div>
      )}
      <nav className="hidden items-center gap-1 py-2 text-subhead text-muted md:flex">
        <Link to="/" className="text-brand">好物集</Link>
        <ChevronRight size={14} aria-hidden="true" />
        <Link to={`/search?cat=${product.categoryId}`} className="text-brand">{category?.name}</Link>
        <ChevronRight size={14} aria-hidden="true" />
        <span className="truncate">{product.title}</span>
      </nav>

      <section className="grid grid-cols-[minmax(0,1fr)] md:grid-cols-[450px_1fr] md:gap-8">
        {/* 照片：手機橫滑露出下一張；桌機全部攤開（大圖＋兩欄），不用另做縮圖切換 */}
        <div className="min-w-0">
          <div
            role="region"
            aria-label={`商品照片，共 ${slides.length} 張`}
            className="no-scrollbar flex snap-x snap-mandatory scroll-px-5 gap-2.5 overflow-x-auto px-5 pt-1 md:grid md:grid-cols-2 md:overflow-visible md:px-0 md:pt-0"
          >
            {slides.map((src, i) => {
              const isVariant = i === 0 && Boolean(variantImage);
              return (
                <div
                  key={isVariant ? 'variant' : i}
                  className="relative w-75 shrink-0 snap-start md:w-auto md:first:col-span-2"
                >
                  <Photo
                    src={src}
                    alt={isVariant && variant ? `${product.title}（${variant.name}），第 1 張` : `${product.title}，第 ${i + 1} 張`}
                    size="lg"
                    className="aspect-square rounded-story"
                    onError={isVariant ? () => setShowVariantImage(false) : undefined}
                  />
                  {isVariant && variant && (
                    <span aria-hidden="true" className="absolute bottom-2 left-2 flex max-w-[calc(100%-1rem)] items-center gap-1.5 rounded-full bg-ink/75 px-2.5 py-1 text-footnote text-white">
                      <span className="shrink-0 font-semibold">規格圖</span>
                      <span className="truncate">{variant.name}</span>
                    </span>
                  )}
                </div>
              );
            })}
          </div>
          <p role="status" className="sr-only">{variantImage && variant ? `已切換為規格圖：${variant.name}` : ''}</p>
        </div>

        {/* 資訊：標題 → 店名 → 價格 → 運費 → 資訊條（R5：價格最粗、已售同列、運費緊貼價格、賣家露臉） */}
        <div className="min-w-0 px-5 pt-4 md:px-0 md:pt-0">
          <h1 className="text-title3 font-bold text-ink">{product.title}</h1>
          <p className="mt-1 text-subhead text-muted">
            {/* 行內連結的熱區撐到 44 高；負 margin 抵銷，不影響行高與版面 */}
            {shop && <><Link to={`/shop/${shop.id}`} className="-mx-2 -my-3 inline-flex min-h-11 items-center px-2 text-brand">{shop.name}</Link>・</>}
            {product.location}出貨
          </p>

          {/* 原價跟著規格走：選了規格看該規格的，沒選就看最低價那個 */}
          <div className="mt-3 flex flex-wrap items-baseline gap-x-2">
            <span className="text-title1 font-bold text-ink">
              {variant ? money(variant.price) : priceRange(product.variants.map(v => v.price))}
            </span>
            {shown?.originalPrice && discount > 0 && (
              <s className="text-subhead text-muted">{money(shown.originalPrice)}</s>
            )}
            {product.sold > 0 && (
              <span className="ml-auto whitespace-nowrap text-subhead text-muted">已售 {soldText(product.sold)}</span>
            )}
          </div>
          <p className="text-footnote text-muted">
            {product.freeShipping ? '免運費' : `運費 ${money(SHIPPING_FEE)}・同店滿 ${money(FREE_SHIPPING_THRESHOLD)} 免運`}
          </p>

          <dl className="mt-4 grid grid-cols-3 border-y-[0.5px] border-separator py-1.5 text-center text-muted [&>div+div]:border-l-[0.5px] [&>div+div]:border-separator">
            <div className="relative min-w-0 px-1 py-1">
              <dt className="text-caption2 font-semibold">評價</dt>
              <dd className="mt-1">
                {/* 整格可點（after 撐滿，格高 ≥44）。評價資料還沒回來或載入失敗時只顯示「—」：不能對有評價的商品說「沒有評價」 */}
                <button
                  type="button"
                  onClick={goReviews}
                  aria-label={stat ? `評價 ${ratingText(stat.avg)} 分，${stat.count} 則` : summaryState === 'ready' ? '還沒有評價' : '評價'}
                  className="flex w-full flex-col items-center transition-opacity duration-200 after:absolute after:inset-0 active:opacity-50 active:duration-0"
                >
                  <span className="text-title3 font-bold">{stat ? ratingText(stat.avg) : '—'}</span>
                  {stat && <span className="text-caption2 font-semibold">{stat.count} 則</span>}
                </button>
              </dd>
            </div>
            <div className="min-w-0 px-1 py-1">
              <dt className="text-caption2 font-semibold">規格</dt>
              <dd className="mt-1 text-title3 font-bold">{product.variants.length} 種</dd>
            </div>
            <div className="min-w-0 px-1 py-1">
              <dt className="text-caption2 font-semibold">出貨地</dt>
              <dd className="mt-1 break-words text-title3 font-bold">{product.location}</dd>
            </div>
          </dl>

          <div className="mt-6 hidden md:block">{picker}</div>
          <div className="mt-8 hidden gap-3 md:flex">
            <button
              type="button"
              onClick={() => { if (!blocked()) act('cart'); }}
              disabled={stock === 0}
              aria-disabled={dimmed || undefined}
              className={`${PILL} h-12 min-w-44 px-6 ${dimmed ? 'bg-canvas text-muted-2' : `bg-canvas text-brand ${PRESS} active:bg-press`} ${SOLD_OUT}`}
            >
              加入購物車
            </button>
            <button
              type="button"
              onClick={() => { if (!blocked()) act('buy'); }}
              disabled={stock === 0}
              aria-disabled={dimmed || undefined}
              className={`${PILL} h-12 min-w-44 px-6 ${dimmed ? 'bg-canvas text-muted-2' : `bg-brand text-white ${PRESS} hover:bg-brand-dark active:bg-brand-dark`} ${SOLD_OUT}`}
            >
              {stock === 0 ? '已售完' : '直接購買'}
            </button>
          </div>
        </div>
      </section>

      {/* 「選擇規格」列：手機才有（桌機規格直接攤在價格下方） */}
      <button
        type="button"
        onClick={() => setSheet('pick')}
        aria-haspopup="dialog"
        className="flex min-h-11 w-full items-center gap-2 border-b-[0.5px] border-separator px-5 py-2 text-left text-body transition-colors duration-200 active:bg-press active:duration-0 md:hidden"
      >
        <span className="shrink-0 text-ink">選擇規格</span>
        <span className="min-w-0 flex-1 break-words text-right text-muted">{variant ? variant.name : `${product.variants.length} 種規格`}</span>
        <ChevronRight size={18} strokeWidth={2.4} className="shrink-0 text-chevron" aria-hidden="true" />
      </button>

      <SectionHeader title="商品詳情" className={SECTION} />
      <p className="whitespace-pre-line break-words px-5 text-body text-ink md:px-0">{product.description}</p>

      {/* 賣家：整列就是店家入口 */}
      {shop && (
        <>
          <SectionHeader title="賣家" className={SECTION} />
          <Link
            to={`/shop/${shop.id}`}
            className="flex items-center gap-3 px-5 py-2 transition-colors duration-200 active:bg-press active:duration-0 md:px-0"
          >
            <LetterAvatar name={shop.name} />
            <span className="min-w-0 flex-1">
              <span className="block break-words text-headline font-semibold text-ink">{shop.name}</span>
              <span className="block text-subhead text-muted">{shop.location}</span>
            </span>
            <ChevronRight size={20} strokeWidth={2.4} className="shrink-0 text-chevron" aria-hidden="true" />
          </Link>
        </>
      )}

      <ProductReviewsSection productId={product.id} />

      {related.length > 0 && (
        <>
          <SectionHeader title="同類商品" to={`/search?cat=${product.categoryId}`} className={SECTION} />
          <Shelf ariaLabel="同類商品" className="md:scroll-px-0 md:px-0">
            {related.map(p => <ProductCard key={p.id} product={p} variant="shelf" />)}
          </Shelf>
        </>
      )}

      {/* 手機購買列：sticky 而不是 fixed，本身佔版面，放大後換成上下兩排也不會蓋住最後的內容。
          自動欄寬：放得下兩顆就並排等寬，放不下（頁面縮放 200%）就上下排 */}
      <div className="material sticky bottom-0 z-40 mt-8 grid grid-cols-[repeat(auto-fit,minmax(--spacing(32),1fr))] gap-3 border-t-[0.5px] border-separator pt-2 pr-[max(--spacing(5),env(safe-area-inset-right))] pb-[calc(--spacing(2)+env(safe-area-inset-bottom))] pl-[max(--spacing(5),env(safe-area-inset-left))] md:hidden">
        <button
          type="button"
          onClick={() => { if (!blocked()) setSheet('cart'); }}
          disabled={stock === 0}
          aria-disabled={dimmed || undefined}
          className={`${PILL} h-12.5 px-4 ${dimmed ? 'bg-canvas text-muted-2' : `bg-canvas text-brand ${PRESS} active:bg-press`} ${SOLD_OUT}`}
        >
          加入購物車
        </button>
        <button
          type="button"
          onClick={() => { if (!blocked()) setSheet('buy'); }}
          disabled={stock === 0}
          aria-disabled={dimmed || undefined}
          className={`${PILL} h-12.5 px-4 ${dimmed ? 'bg-canvas text-muted-2' : `bg-brand text-white ${PRESS} active:bg-brand-dark`} ${SOLD_OUT}`}
        >
          {stock === 0 ? '已售完' : '直接購買'}
        </button>
      </div>

      {sheet && (
        <div className="fixed inset-0 z-50 md:hidden" role="dialog" aria-modal="true" aria-label="選擇規格與數量">
          <div className="animate-fade absolute inset-0 bg-black/45" onClick={() => setSheet(null)} />
          {/* 曲線照 §3.7（.32,.72,0,1／280ms）；減少動態時改 150ms 淡入 */}
          <div className="pb-safe absolute inset-x-0 bottom-0 max-h-[80dvh] overflow-y-auto rounded-t-story bg-white animate-sheet">
            <div className="flex gap-3 border-b-[0.5px] border-separator p-4">
              <Photo src={variant?.image ?? product.images[0]} alt="" size="sm" className="size-20 shrink-0" />
              <div className="flex flex-1 flex-col justify-end">
                <p className="flex flex-wrap items-baseline gap-x-2">
                  <span className="text-title3 font-bold text-ink">{variant ? money(variant.price) : priceRange(product.variants.map(v => v.price))}</span>
                  {shown?.originalPrice && discount > 0 && (
                    <s className="text-footnote text-muted">{money(shown.originalPrice)}</s>
                  )}
                </p>
                <p className="text-footnote text-muted">庫存 {stock}</p>
              </div>
              <button type="button" onClick={() => setSheet(null)} aria-label="關閉" className="-mr-2 -mt-2 flex size-11 shrink-0 items-center justify-center self-start text-muted">
                <X size={22} aria-hidden="true" />
              </button>
            </div>
            <div className="p-4">{picker}</div>
            <button
              type="button"
              onClick={() => {
                if (sheet === 'pick') setSheet(null);
                else if (!blocked() && act(sheet)) setSheet(null);
              }}
              className={`${PILL} m-4 mt-2 h-12.5 w-[calc(100%-2rem)] bg-brand text-white ${PRESS} active:bg-brand-dark`}
            >
              {sheet === 'pick' ? '完成' : sheet === 'cart' ? '加入購物車' : '直接購買'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** 區塊標題外距：手機同 SectionHeader 預設（上 32、左右 20、下 12）；桌機內容不留左右邊，標題跟著對齊 */
const SECTION = 'mx-5 mt-8 mb-3 md:mx-0';
/** 膠囊鈕共用：字級與過渡。按下縮放只在「減少動態」關閉時（§3.7：按下 100ms，放開 150ms） */
const PILL = 'inline-flex items-center justify-center rounded-full text-headline font-semibold transition-[scale,background-color] duration-150 active:duration-100 motion-reduce:transition-none';
const PRESS = 'motion-safe:active:scale-[0.97]';
/** 庫存 0：原生 disabled，不縮放、不換色 */
const SOLD_OUT = 'disabled:scale-100 disabled:bg-canvas disabled:text-muted-2';

function VariantPicker(props: {
  product: Product; variantId: string | null; onPick: (id: string) => void;
  qty: number; setQty: (n: number) => void; stock: number; needPick: boolean;
}) {
  const { product, variantId, onPick, qty, setQty, stock, needPick } = props;
  return (
    <div className={`space-y-5 rounded-card ${needPick ? 'bg-error-bg p-3 ring-1 ring-error-border' : ''}`}>
      <div className="flex flex-col gap-2 md:flex-row md:gap-4">
        <span className="w-20 shrink-0 pt-3 text-subhead text-muted">規格</span>
        <div className="flex flex-wrap gap-2">
          {product.variants.map(v => (
            <button
              key={v.id}
              type="button"
              disabled={v.stock === 0}
              aria-pressed={v.id === variantId}
              onClick={() => onPick(v.id)}
              className={`min-h-11 max-w-full break-words rounded-full border px-4 py-2 text-left text-subhead transition-colors duration-200 active:duration-0 disabled:cursor-not-allowed disabled:border-dashed disabled:border-line disabled:bg-white disabled:text-muted-2 ${
                v.id === variantId ? 'border-brand bg-white text-brand' : 'border-transparent bg-canvas text-ink active:bg-press'
              }`}
            >
              <span>{v.name}</span>
              <span className="ml-1.5 text-footnote text-muted">{money(v.price)}</span>
            </button>
          ))}
        </div>
      </div>
      <div className="flex items-center gap-4">
        <span className="w-20 shrink-0 text-subhead text-muted">數量</span>
        <QtyStepper value={qty} max={Math.max(1, stock)} onChange={setQty} />
        <span className="text-subhead text-muted">還剩 {stock} 件</span>
      </div>
      {needPick && <p className="text-subhead text-error-text">請先選擇規格</p>}
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
    <div className="px-5 pt-2 md:px-0">
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
