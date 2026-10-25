import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, LoaderCircle, Star } from 'lucide-react';
import { useStore } from '../../store/StoreContext';
import { useReviews } from '../../store/ReviewsContext';
import EmptyState from '../../components/EmptyState';
import ProductImage from '../../components/ProductImage';
import ReviewCard from '../../components/reviews/ReviewCard';
import ReviewTabs from '../../components/reviews/ReviewTabs';
import { FilterChips } from '../../components/reviews/FilterChips';
import { EmptyBlock, InlineError, ReviewSkeleton } from '../../components/reviews/states';
import { useLightbox } from '../../components/reviews/useLightbox';
import { btnOutline } from '../../components/import/ui';
import { getProductReviews, getShopReviews } from '../../lib/reviews/api';
import { NO_FILTER, isFiltering, resolveShopId, type BuyerFilter } from '../../lib/reviews/filters';
import { ratingText } from '../../lib/reviews/format';
import { PAGE_SIZE, type PublicReview, type PublicReviewList } from '../../lib/reviews/types';

type Tab = 'product' | 'shop';
type Meta = Pick<PublicReviewList, 'total' | 'with_photos' | 'counts' | 'filtered_total' | 'product'>;

/**
 * 評價總覽 #/product/:id/reviews。
 * 不依賴商品目前是否可見：商品名稱與圖片用評價裡的快照，商品下架或刪除後評價仍然看得到（R-15）。
 */
export default function ReviewsOverview() {
  const { id = '' } = useParams();
  // 用 key：在網址上換成另一個商品時，分頁、篩選、列表與快照的店 id 都回到新商品的初始狀態
  return <ReviewsOverviewView key={id} id={id} />;
}

function ReviewsOverviewView({ id }: { id: string }) {
  const { getProduct, getShop } = useStore();
  const { productStat, shopStat } = useReviews();
  const product = getProduct(id);
  // 賣場評價需要知道這件商品屬於哪家店：商品還看得到就用它；下架或刪除（匿名讀不到 products）時，
  // 用商品評價回傳的快照 shop_id。快照要另外記下來：切到賣場分頁後，回傳的 product 會是 null
  const [snapShopId, setSnapShopId] = useState<string | null>(null);
  const shopId = resolveShopId(product, snapShopId ? { shop_id: snapShopId } : null);
  const shop = shopId ? getShop(shopId) : undefined;
  // 取得快照 shop_id 後 shopId 才有值；用 ref 讀它，才不會讓 fetchPage 換身分、把剛載好的列表又重載一次
  const shopIdRef = useRef(shopId);
  shopIdRef.current = shopId;

  const [tab, setTab] = useState<Tab>('product');
  const [filter, setFilter] = useState<BuyerFilter>(NO_FILTER);
  const [reviews, setReviews] = useState<PublicReview[]>([]);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [more, setMore] = useState<'idle' | 'loading' | 'error'>('idle');
  const seq = useRef(0);
  const listRef = useRef<HTMLDivElement>(null);
  const skipScroll = useRef(true);
  const lightbox = useLightbox();

  const fetchPage = useCallback((t: Tab, f: BuyerFilter, offset: number) => {
    const args = { rating: f.rating, withPhotos: f.photos, limit: PAGE_SIZE, offset };
    const sid = shopIdRef.current;
    return t === 'shop' && sid ? getShopReviews(sid, args) : getProductReviews(id, args);
  }, [id]);

  const loadFirst = useCallback(async (t: Tab, f: BuyerFilter) => {
    const mine = ++seq.current;
    setState('loading');
    setMore('idle');
    try {
      const data = await fetchPage(t, f, 0);
      if (mine !== seq.current) return;
      setReviews(data.reviews);
      setMeta(data);
      if (data.product) setSnapShopId(data.product.shop_id);
      setState('ready');
    } catch {
      if (mine === seq.current) setState('error');
    }
  }, [fetchPage]);

  useEffect(() => { void loadFirst(tab, filter); }, [loadFirst, tab, filter]);

  // 切換篩選後，結果回來把列表頂端捲進畫面（第一次進頁不捲）
  useEffect(() => {
    if (state !== 'ready') return;
    if (skipScroll.current) { skipScroll.current = false; return; }
    const el = listRef.current;
    if (el && el.getBoundingClientRect().top < 0) el.scrollIntoView({ block: 'start' });
  }, [state, tab, filter]);

  const loadMore = async () => {
    if (more === 'loading') return;
    const mine = seq.current;
    setMore('loading');
    try {
      const data = await fetchPage(tab, filter, reviews.length);
      if (mine !== seq.current) return;
      // 載入更多期間若有新評價插進來，後面的頁會重複；用 id 去重，已顯示的不動
      setReviews(prev => {
        const seen = new Set(prev.map(r => r.id));
        return [...prev, ...data.reviews.filter(r => !seen.has(r.id))];
      });
      setMeta(data);
      setMore('idle');
    } catch {
      if (mine === seq.current) setMore('error');
    }
  };

  const changeTab = (t: Tab) => { setTab(t); setFilter(NO_FILTER); setReviews([]); setMeta(null); };
  const changeFilter = (f: BuyerFilter) => { setFilter(f); };

  if (!product && state === 'ready' && meta?.total === 0 && tab === 'product') {
    return (
      <div className="mx-auto max-w-6xl p-3 md:p-6">
        <EmptyState title="商品不存在或已下架" action={<Link to="/" className="text-brand">回首頁</Link>} />
      </div>
    );
  }

  const stat = tab === 'shop' ? (shopId ? shopStat(shopId) : undefined) : productStat(id);
  const title = tab === 'shop' ? shop?.name : (meta?.product?.title ?? product?.title);
  const image = meta?.product?.image ?? product?.images[0];
  const total = meta?.total;
  const hasAny = (meta?.total ?? 1) > 0;
  const hasMore = meta !== null && reviews.length < meta.filtered_total;

  const tabs = shopId
    ? ([{ id: 'product', label: '商品評價' }, { id: 'shop', label: '賣場評價' }] as const)
    : null;

  return (
    <div className="mx-auto max-w-4xl md:px-4 md:pt-6">
      <header className="flex items-center gap-1 bg-white px-2 pr-4 md:rounded-t-md">
        <Link to={product ? `/product/${id}` : '/'} aria-label={product ? '回商品頁' : '回首頁'} className="flex h-11 w-11 shrink-0 items-center justify-center">
          <ArrowLeft size={22} aria-hidden="true" />
        </Link>
        {tab === 'shop' && shop ? (
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-line bg-canvas text-2xl" aria-hidden="true">{shop.avatar}</span>
        ) : image ? (
          <ProductImage src={image} alt="" size="sm" className="w-10 shrink-0 rounded-sm border border-line" />
        ) : null}
        <div className="min-w-0 flex-1 py-2">
          <h1 className={`line-clamp-1 text-sm ${tab === 'shop' ? 'font-medium' : ''}`}>{title ?? '商品評價'}</h1>
          <p className="flex items-center gap-1 text-xs text-muted">
            {stat && (
              <>
                <span className="font-medium text-ink">{ratingText(stat.avg)}</span>
                <Star size={12} className="fill-star text-star" aria-hidden="true" />
              </>
            )}
            {tab === 'product' && total !== undefined && <span>共 {total} 則評價</span>}
            {tab === 'shop' && stat && <span>共 {stat.count} 則評價</span>}
          </p>
        </div>
      </header>

      {tabs ? (
        <ReviewTabs tabs={tabs} value={tab} onChange={changeTab} label="評價類型" sticky />
      ) : (
        <div className="border-b border-line bg-white" />
      )}

      <div className="bg-white md:rounded-b-md">
        {hasAny && (
          <FilterChips
            filter={filter} onChange={changeFilter}
            total={meta?.total} withPhotos={meta?.with_photos} counts={meta?.counts}
          />
        )}

        {isFiltering(filter) && meta && state === 'ready' && (
          <p aria-live="polite" className="border-t border-line px-4 pt-3 text-xs text-muted">符合條件：{meta.filtered_total} 則</p>
        )}

        <div ref={listRef} className="scroll-mt-28 px-4 md:px-6">
          {state === 'loading' && <ReviewSkeleton rows={3} />}
          {state === 'error' && <InlineError title="評價載入失敗" onRetry={() => void loadFirst(tab, filter)} />}
          {state === 'ready' && !hasAny && (
            <EmptyBlock icon="💬" title="尚無評價" description="買家收到商品並評價後，會顯示在這裡" />
          )}
          {state === 'ready' && hasAny && reviews.length === 0 && (
            <div className="flex flex-col items-center gap-3 px-6 py-14 text-center">
              <p className="text-sm">沒有符合的評價</p>
              {isFiltering(filter) && <button type="button" onClick={() => setFilter(NO_FILTER)} className={btnOutline}>清除篩選</button>}
            </div>
          )}
          {state === 'ready' && reviews.length > 0 && (
            <div className="divide-y divide-line">
              {reviews.map(r => (
                <ReviewCard key={r.id} review={r} showProduct={tab === 'shop'} onOpenPhoto={(p, i, el) => lightbox.open(p, i, el)} />
              ))}
            </div>
          )}
        </div>

        {state === 'ready' && reviews.length > 0 && meta && (
          <div className="p-4">
            {more === 'error' && <p role="alert" className="mb-2 text-sm text-error-text">載入失敗，請再試一次</p>}
            {hasMore && (
              <button type="button" onClick={() => void loadMore()} aria-disabled={more === 'loading' || undefined} className={`${btnOutline} w-full`}>
                {more === 'loading' ? <><LoaderCircle size={18} className="motion-safe:animate-spin" aria-hidden="true" />載入中…</> : '載入更多'}
              </button>
            )}
            <p className="mt-2 text-center text-xs text-muted">已顯示 {reviews.length} 則，共 {meta.filtered_total} 則</p>
          </div>
        )}
      </div>
      {lightbox.element}
    </div>
  );
}
