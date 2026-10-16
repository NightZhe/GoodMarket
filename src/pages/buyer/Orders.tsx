import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronDown, Store, TriangleAlert } from 'lucide-react';
import { useStore } from '../../store/StoreContext';
import { useRefreshOnVisible, useReviews } from '../../store/ReviewsContext';
import OrderReviewRow, { OrderReviewRowSkeleton } from '../../components/reviews/OrderReviewRow';
import ProductImage from '../../components/ProductImage';
import EmptyState from '../../components/EmptyState';
import { dateText, money } from '../../lib/format';
import OrderTimeline from '../../components/OrderTimeline';
import type { OrderStatus } from '../../types';

export const STATUS_LABEL: Record<OrderStatus, string> = {
  to_ship: '待出貨', shipping: '運送中', completed: '已完成', cancelled: '已取消',
};

const TABS: { id: OrderStatus | 'all'; label: string }[] = [
  { id: 'all', label: '全部' }, { id: 'to_ship', label: '待出貨' }, { id: 'shipping', label: '待收貨' },
  { id: 'completed', label: '完成' }, { id: 'cancelled', label: '不成立' },
];

// 買家不需要帳號：下單時拿到的憑證存在這台瀏覽器，用它回來查自己的訂單
export default function Orders() {
  const { myOrders, getShop, cancelMyOrder, completeMyOrder, refreshMyOrders } = useStore();
  const [tab, setTab] = useState<OrderStatus | 'all'>('all');
  const [openId, setOpenId] = useState<string | null>(null);
  const { statusState, statusOf, refreshStatus } = useReviews();
  const list = myOrders.filter(o => tab === 'all' || o.status === tab);
  const hasCompleted = list.some(o => o.status === 'completed');

  useEffect(() => { void refreshMyOrders(); }, [refreshMyOrders]);
  // 評價期限會隨時間跨過：進頁與從背景回來都重新取得（保留舊畫面，不閃骨架）。
  // 「已完成」的訂單集合變了（按了「完成訂單」）也要重新取得，否則剛完成的訂單要重新整理才有評價列
  const completedKey = myOrders.filter(o => o.status === 'completed').map(o => o.id).join(',');
  const [checkedKey, setCheckedKey] = useState<string | null>(null);
  useEffect(() => {
    let current = true;
    void refreshStatus(true).then(() => { if (current) setCheckedKey(completedKey); });
    return () => { current = false; };
  }, [refreshStatus, completedKey]);
  useRefreshOnVisible(() => { void refreshStatus(true); });

  return (
    <div className="mx-auto max-w-4xl md:px-4 md:pt-6">
      <div className="no-scrollbar sticky top-[52px] z-20 flex overflow-x-auto bg-white md:top-[108px] md:rounded-t-md">
        {TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`flex-1 shrink-0 border-b-2 px-4 py-3.5 text-sm ${tab === t.id ? 'border-brand text-brand' : 'border-line'}`}>
            {t.label}
          </button>
        ))}
      </div>
      {statusState === 'error' && hasCompleted && (
        <div className="mt-2 flex items-start gap-2 bg-warning-bg px-4 py-2.5 text-sm text-ink md:mt-3 md:rounded-md">
          <TriangleAlert size={16} className="mt-0.5 shrink-0 text-warning-text" aria-hidden="true" />
          <span className="flex-1">評價狀態暫時載入失敗</span>
          <button
            type="button" onClick={() => void refreshStatus()}
            className="-my-2 min-h-11 px-2 underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
          >
            重試
          </button>
        </div>
      )}
      <div className="mt-2 space-y-2 md:mt-3 md:space-y-3">
        {list.length === 0 ? (
          <EmptyState icon="🧾" title="還沒有訂單" action={<Link to="/" className="text-brand">去逛逛</Link>} />
        ) : list.map(o => (
          <article key={o.id} className="bg-white md:rounded-md">
            <header className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b border-line px-4 py-3 text-sm">
              <Link to={`/shop/${o.shopId}`} className="flex items-center gap-1.5 font-medium"><Store size={16} />{getShop(o.shopId)?.name}</Link>
              <span className="order-3 w-full font-mono text-xs text-muted md:order-none md:w-auto">訂單編號 {o.orderNo}</span>
              <span className="text-brand">{STATUS_LABEL[o.status]}</span>
            </header>
            {o.lines.map(l => (
              <Link to={`/product/${l.productId}`} key={l.variantId} className="flex gap-3 px-4 py-3">
                <ProductImage src={l.image} alt="" size="sm" className="w-16 rounded-sm border border-line" />
                <div className="min-w-0 flex-1">
                  <p className="line-clamp-2 text-sm">{l.title}</p>
                  <p className="text-xs text-muted">規格：{l.variantName} ×{l.qty}</p>
                </div>
                <p className="text-sm">{money(l.price)}</p>
              </Link>
            ))}
            {/* 物流進度：買家與賣家看到同一份歷程 */}
            <div className="border-t border-line px-4 py-3">
              <button
                onClick={() => setOpenId(openId === o.id ? null : o.id)}
                className="flex w-full items-center justify-between text-sm"
              >
                <span className="flex items-center gap-1.5">
                  🚚 <span className="text-muted">運送進度</span>
                  {o.trackingNo && <span className="font-mono text-xs text-success-text"># {o.trackingNo}</span>}
                </span>
                <ChevronDown size={16} className={`text-muted transition ${openId === o.id ? 'rotate-180' : ''}`} />
              </button>
              {openId === o.id && <div className="mt-3"><OrderTimeline order={o} /></div>}
            </div>

            {o.status === 'completed' && (() => {
              const rs = statusOf(o.id);
              if (rs) return <OrderReviewRow status={rs} />;
              // 還沒取得這張單的評價狀態（剛完成、或第一次載入）時先放骨架，取得後才決定要不要顯示
              return statusState === 'loading' || (statusState !== 'error' && checkedKey !== completedKey)
                ? <OrderReviewRowSkeleton /> : null;
            })()}

            <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-line bg-[#fffefb] px-4 py-3">
              <span className="text-xs text-muted">{dateText(o.createdAt)}</span>
              <div className="flex items-center gap-3">
                <span className="text-sm">訂單金額 <span className="text-lg text-brand">{money(o.total)}</span></span>
                {o.status === 'to_ship' && (
                  <button onClick={() => void cancelMyOrder(o.id)} className="rounded-sm border border-line px-3 py-1.5 text-sm">取消訂單</button>
                )}
                {o.status === 'shipping' && (
                  <button onClick={() => void completeMyOrder(o.id)} className="rounded-sm bg-brand px-3 py-1.5 text-sm text-white">完成訂單</button>
                )}
              </div>
            </footer>
          </article>
        ))}
      </div>
    </div>
  );
}
