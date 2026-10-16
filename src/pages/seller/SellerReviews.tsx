import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { LoaderCircle } from 'lucide-react';
import ReviewTabs from '../../components/reviews/ReviewTabs';
import { RatingRadioChips } from '../../components/reviews/FilterChips';
import SellerReviewCard from '../../components/reviews/SellerReviewCard';
import { StarsAvg } from '../../components/reviews/Stars';
import { EmptyBlock, ReviewSkeleton } from '../../components/reviews/states';
import { useLightbox } from '../../components/reviews/useLightbox';
import { btnOutline } from '../../components/import/ui';
import { getSellerReviewCounts, getSellerReviews } from '../../lib/reviews/api';
import { needsNormalize, readSellerState, writeSellerState } from '../../lib/reviews/filters';
import { ratingText } from '../../lib/reviews/format';
import {
  PAGE_SIZE, type ReplyResult, type SellerReview, type SellerReviewCounts, type SellerReviewList, type SellerTab,
} from '../../lib/reviews/types';
import { useRefreshOnVisible } from '../../store/ReviewsContext';

const TABS = [{ id: 'all', label: '全部' }, { id: 'unreplied', label: '待回覆' }] as const;

type Meta = Pick<SellerReviewList, 'counts' | 'total'>;

/** 賣家後台的評價管理 #/seller/reviews：全部／待回覆分頁、星等篩選（狀態存在網址）、回覆 */
export default function SellerReviews() {
  const [params, setParams] = useSearchParams();
  const { tab, rating } = readSellerState(params);

  // 網址帶了不合法的值：把網址改成實際顯示的狀態（預設值不寫進網址）
  useEffect(() => {
    if (needsNormalize(params)) setParams(writeSellerState(params, readSellerState(params)), { replace: true });
  }, [params, setParams]);

  const [reviews, setReviews] = useState<SellerReview[]>([]);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [more, setMore] = useState<'idle' | 'loading' | 'error'>('idle');
  const [summary, setSummary] = useState<SellerReviewCounts | null>(null);
  const [announce, setAnnounce] = useState('');
  const seq = useRef(0);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const pendingFocus = useRef<number | null>(null);
  const lightbox = useLightbox();

  const load = useCallback(async (t: SellerTab, r: number | null, silent = false) => {
    const mine = ++seq.current;
    if (!silent) { setState('loading'); setMore('idle'); }
    try {
      const data = await getSellerReviews(t, r, PAGE_SIZE, 0);
      if (mine !== seq.current) return;
      setReviews(data.reviews);
      setMeta(data);
      setState('ready');
    } catch {
      if (mine === seq.current && !silent) setState('error');
    }
  }, []);

  const loadSummary = useCallback(() => {
    getSellerReviewCounts().then(setSummary, () => { /* 大字評分取不到時，摘要卡顯示「–」；列表自己有錯誤畫面 */ });
  }, []);

  useEffect(() => { void load(tab, rating); }, [load, tab, rating]);
  useEffect(loadSummary, [loadSummary]);
  // 從背景回來：靜默重新取得（保留捲動位置與編輯中的回覆草稿）
  useRefreshOnVisible(() => { void load(tab, rating, true); loadSummary(); });

  const setFilters = (next: { tab: SellerTab; rating: number | null }) => {
    setParams(writeSellerState(params, next), { replace: true });
  };

  const loadMore = async () => {
    if (more === 'loading') return;
    const mine = seq.current;
    setMore('loading');
    try {
      const data = await getSellerReviews(tab, rating, PAGE_SIZE, reviews.length);
      if (mine !== seq.current) return;
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

  const onReplied = (index: number, res: ReplyResult) => {
    const target = reviews[index];
    if (tab === 'unreplied' && target && target.seller_reply === null) {
      // 待回覆分頁：回覆成功後這則從列表消失，各個數字跟著減 1
      const remaining = meta ? meta.counts.all - 1 : 0;
      setReviews(prev => prev.filter(r => r.id !== res.id));
      setMeta(m => {
        if (!m) return m;
        const key = String(target.rating) as '1';
        return { total: Math.max(0, m.total - (rating === null || rating === target.rating ? 1 : 0)), counts: { ...m.counts, all: Math.max(0, m.counts.all - 1), [key]: Math.max(0, m.counts[key] - 1) } };
      });
      setAnnounce(`已回覆，待回覆還有 ${remaining} 則`);
      pendingFocus.current = index;
    } else {
      setReviews(prev => prev.map(r => (r.id === res.id ? { ...r, seller_reply: res.seller_reply, seller_replied_at: res.seller_replied_at } : r)));
    }
  };

  // 回覆成功後把焦點移到下一張卡片的「回覆」鈕；沒有下一張就移到標題
  useEffect(() => {
    const i = pendingFocus.current;
    if (i === null) return;
    pendingFocus.current = null;
    const btns = listRef.current?.querySelectorAll<HTMLElement>('[data-reply-btn]');
    (btns && btns.length > 0 ? btns[Math.min(i, btns.length - 1)] : headingRef.current)?.focus();
  }, [reviews]);

  const empty = state === 'ready' && meta !== null && meta.counts.all === 0;
  const filteredEmpty = state === 'ready' && !empty && reviews.length === 0;
  const hasMore = meta !== null && reviews.length < meta.total;
  const noReviewsAtAll = summary !== null && summary.rating === null;

  return (
    <div className="mx-auto max-w-5xl">
      <h1 ref={headingRef} tabIndex={-1} className="text-xl font-bold outline-none">評價管理</h1>

      <div className="mt-4 rounded-lg bg-white">
        <ReviewTabs tabs={TABS} value={tab} onChange={t => setFilters({ tab: t, rating: null })} label="評價分頁" />

        <div className="border-b border-line p-4 md:flex md:items-center md:gap-8 md:p-5">
          <div className="md:w-48 md:shrink-0">
            {noReviewsAtAll ? (
              <p className="text-xl font-semibold text-muted">尚無評價</p>
            ) : (
              <div className="flex items-center gap-4 md:flex-col md:items-start md:gap-1.5">
                <p className="text-4xl font-semibold leading-none text-brand md:text-5xl">
                  {summary?.rating != null ? ratingText(summary.rating) : '–'}
                  <span className="ml-1 text-sm font-normal text-muted">/ 5</span>
                </p>
                <div className="space-y-1">
                  {summary?.rating != null && <StarsAvg value={summary.rating} count={summary.review_count} />}
                  {summary && <p className="text-xs text-muted">賣場評分，依 {summary.review_count} 則公開評價計算</p>}
                </div>
              </div>
            )}
          </div>
          {!empty && !(state === 'ready' && noReviewsAtAll) && (
            <div className="mt-4 md:mt-0 md:flex-1">
              <RatingRadioChips value={rating} counts={meta?.counts} onChange={r => setFilters({ tab, rating: r })} />
            </div>
          )}
        </div>

        <div ref={listRef}>
          {state === 'loading' && <ReviewSkeleton rows={2} seller />}
          {state === 'error' && (
            <div className="px-6 py-14 text-center">
              <p className="text-5xl" aria-hidden="true">📡</p>
              <p role="alert" className="mt-4 font-medium">載入評價失敗</p>
              <p className="mt-1 text-sm text-muted">請檢查網路後再試一次</p>
              <button onClick={() => void load(tab, rating)} className="mt-5 rounded-sm bg-brand px-6 py-2.5 text-sm text-white">重新載入</button>
            </div>
          )}
          {empty && tab === 'all' && <EmptyBlock icon="💬" title="還沒有評價" description="買家完成訂單後就能評價" />}
          {empty && tab === 'unreplied' && <EmptyBlock icon="✅" title="沒有待回覆的評價" description="有新評價時會出現在這裡" />}
          {filteredEmpty && (
            <EmptyBlock
              icon="🔍" title="沒有符合的評價"
              action={<button type="button" onClick={() => setFilters({ tab, rating: null })} className={`${btnOutline} mt-2`}>清除篩選</button>}
            />
          )}
          {state === 'ready' && reviews.length > 0 && (
            <div className="divide-y divide-line">
              {reviews.map((r, i) => (
                <SellerReviewCard
                  key={r.id} review={r}
                  onReplied={res => onReplied(i, res)}
                  onHidden={id => setReviews(prev => prev.map(x => (x.id === id ? { ...x, hidden: true } : x)))}
                  onReload={() => void load(tab, rating)}
                  onOpenPhoto={(p, idx, el) => lightbox.open(p, idx, el)}
                />
              ))}
            </div>
          )}
        </div>

        {state === 'ready' && reviews.length > 0 && meta && (
          <div className="border-t border-line p-4">
            {more === 'error' && <p role="alert" className="mb-2 text-sm text-error-text">載入失敗，請再試一次</p>}
            {hasMore && (
              <button type="button" onClick={() => void loadMore()} aria-disabled={more === 'loading' || undefined} className={`${btnOutline} w-full`}>
                {more === 'loading' ? <><LoaderCircle size={18} className="motion-safe:animate-spin" aria-hidden="true" />載入中…</> : '載入更多'}
              </button>
            )}
            <p className="mt-2 text-center text-xs text-muted">已顯示 {reviews.length} 則，共 {meta.total} 則</p>
          </div>
        )}
      </div>

      <p role="status" className="sr-only">{announce}</p>
      {lightbox.element}
    </div>
  );
}
