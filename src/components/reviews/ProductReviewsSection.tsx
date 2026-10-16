import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight, MessageSquare } from 'lucide-react';
import { getProductReviews } from '../../lib/reviews/api';
import type { PublicReviewList } from '../../lib/reviews/types';
import { ratingText } from '../../lib/reviews/format';
import { useReviews } from '../../store/ReviewsContext';
import { btnOutline } from '../import/ui';
import ReviewCard from './ReviewCard';
import { StarsAvg } from './Stars';
import { InlineError, ReviewSkeleton } from './states';
import { useLightbox } from './useLightbox';

const PREVIEW = 3;

/** 商品頁的評價區塊（S-3）：平均、最新 3 則、查看全部。載入中／失敗／0 則各有自己的畫面 */
export default function ProductReviewsSection({ productId }: { productId: string }) {
  const { productStat } = useReviews();
  const [data, setData] = useState<PublicReviewList | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const lightbox = useLightbox();

  const load = useCallback(async () => {
    setState('loading');
    try {
      setData(await getProductReviews(productId, { rating: null, withPhotos: false, limit: PREVIEW, offset: 0 }));
      setState('ready');
    } catch {
      setState('error');
    }
  }, [productId]);

  useEffect(() => { void load(); }, [load]);

  const stat = productStat(productId);
  const total = data?.total ?? 0;
  const allLink = `/product/${productId}/reviews`;

  return (
    <section
      id="reviews" aria-labelledby="reviews-title"
      className="mt-2 scroll-mt-16 bg-white p-4 md:mt-4 md:grid md:grid-cols-[13rem_minmax(0,1fr)] md:gap-10 md:rounded-md md:p-6"
    >
      <div>
        <div className="flex items-center justify-between">
          <h2 id="reviews-title" className="text-base font-medium">商品評價{state === 'ready' && total > 0 && ` (${total})`}</h2>
          {state === 'ready' && total > 0 && (
            <Link to={allLink} className="-mr-2 inline-flex min-h-11 items-center gap-0.5 px-2 text-sm md:hidden">
              查看全部<ChevronRight size={16} aria-hidden="true" />
            </Link>
          )}
        </div>
        {state === 'ready' && total > 0 && stat && (
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="flex items-baseline gap-1">
              <span className="text-3xl font-semibold text-brand md:text-5xl">{ratingText(stat.avg)}</span>
              <span className="text-sm text-muted">/ 5</span>
            </span>
            <StarsAvg value={stat.avg} count={stat.count} />
          </div>
        )}
        {state === 'ready' && total > 0 && (
          <div className="hidden md:block">
            <Link to={allLink} className={`${btnOutline} mt-5`}>查看全部 {total} 則評價</Link>
          </div>
        )}
      </div>

      <div className="min-w-0">
        {state === 'loading' && <ReviewSkeleton rows={2} />}
        {state === 'error' && <InlineError title="評價載入失敗" onRetry={() => void load()} />}
        {state === 'ready' && total === 0 && (
          <div className="flex flex-col items-center gap-1 px-6 py-10 text-center">
            <MessageSquare size={32} className="text-disabled" aria-hidden="true" />
            <p className="mt-1 text-sm">尚無評價</p>
            <p className="text-xs text-muted">買家收到商品並評價後，會顯示在這裡</p>
          </div>
        )}
        {state === 'ready' && data && total > 0 && (
          <>
            <div className="divide-y divide-line">
              {data.reviews.map(r => <ReviewCard key={r.id} review={r} clamp onOpenPhoto={(p, i, el) => lightbox.open(p, i, el)} />)}
            </div>
            {total > PREVIEW && (
              <div className="md:hidden">
                <Link to={allLink} className={`${btnOutline} mt-2 flex w-full`}>查看全部 {total} 則評價</Link>
              </div>
            )}
          </>
        )}
      </div>
      {lightbox.element}
    </section>
  );
}
