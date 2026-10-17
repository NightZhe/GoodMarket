import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronDown, LoaderCircle, Store, TriangleAlert, WifiOff } from 'lucide-react';
import { useStore } from '../../store/StoreContext';
import LoginRequired from '../../components/auth/LoginRequired';
import { useToast } from '../../components/Toast';
import { accountErrorText, toAccountError } from '../../lib/account/errors';
import { btnOutline } from '../../components/import/ui';
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

// 我的訂單：要先登入，只看得到自己帳號的訂單，換裝置登入也看得到（D1、D16）
export default function Orders() {
  return (
    <LoginRequired kind="orders">
      <OrdersView />
    </LoginRequired>
  );
}

function OrderSkeleton() {
  return (
    <div aria-busy="true" className="space-y-2 md:space-y-3">
      <p role="status" className="sr-only">載入中</p>
      {[0, 1].map(i => (
        <div key={i} aria-hidden="true" className="bg-white md:rounded-md">
          <div className="border-b border-line px-4 py-3"><div className="h-4 w-28 rounded-sm bg-line motion-safe:animate-pulse" /></div>
          <div className="flex gap-3 px-4 py-3">
            <span className="h-16 w-16 shrink-0 rounded-sm bg-line motion-safe:animate-pulse" />
            <div className="flex-1 space-y-2 pt-1">
              <div className="h-3.5 w-3/4 rounded-sm bg-line motion-safe:animate-pulse" />
              <div className="h-3 w-1/3 rounded-sm bg-line motion-safe:animate-pulse" />
            </div>
          </div>
          <div className="border-t border-line px-4 py-3"><div className="h-4 w-1/2 rounded-sm bg-line motion-safe:animate-pulse" /></div>
        </div>
      ))}
    </div>
  );
}

function OrdersView() {
  const { myOrders, myOrdersState, myOrdersIssue, getShop, cancelMyOrder, completeMyOrder, refreshMyOrders } = useStore();
  const toast = useToast();
  const [busy, setBusy] = useState<{ id: string; kind: 'cancel' | 'complete' } | null>(null);
  const [retrying, setRetrying] = useState(false);
  const [tab, setTab] = useState<OrderStatus | 'all'>('all');
  const [openId, setOpenId] = useState<string | null>(null);
  const { statusState, statusOf, refreshStatus } = useReviews();
  const list = myOrders.filter(o => tab === 'all' || o.status === tab);
  const hasCompleted = list.some(o => o.status === 'completed');

  useEffect(() => { void refreshMyOrders(true); }, [refreshMyOrders]);
  // 評價期限會隨時間跨過：進頁與從背景回來都重新取得（保留舊畫面，不閃骨架）。
  // 「已完成」的訂單集合變了（按了「完成訂單」）也要重新取得，否則剛完成的訂單要重新整理才有評價列
  const completedKey = myOrders.filter(o => o.status === 'completed').map(o => o.id).join(',');
  const [checkedKey, setCheckedKey] = useState<string | null>(null);
  useEffect(() => {
    let current = true;
    void refreshStatus(true).then(() => { if (current) setCheckedKey(completedKey); });
    return () => { current = false; };
  }, [refreshStatus, completedKey]);
  useRefreshOnVisible(() => { void refreshStatus(true); void refreshMyOrders(true); });

  // 取消、完成：處理中不能重複按；狀態已經變了（賣家剛出貨）時資料庫會回錯誤，說明並讓畫面追上
  const act = async (id: string, kind: 'cancel' | 'complete') => {
    if (busy) return;
    setBusy({ id, kind });
    try {
      await (kind === 'cancel' ? cancelMyOrder(id) : completeMyOrder(id));
    } catch (e) {
      const err = toAccountError(e);
      toast(
        err.code === 'ORDER_STATE_CHANGED'
          ? (kind === 'cancel' ? '這筆訂單已經出貨，無法取消。畫面已更新。' : '這筆訂單的狀態已經改變，無法完成。畫面已更新。')
          : accountErrorText(err, '操作失敗，請稍後再試'),
        'error',
      );
    } finally {
      setBusy(null);
    }
  };

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
        {myOrdersState === 'idle' || myOrdersState === 'loading' ? (
          <OrderSkeleton />
        ) : myOrdersState === 'error' ? (
          <div className="bg-white px-4 py-16 text-center md:rounded-md">
            <WifiOff size={40} className="mx-auto text-muted" aria-hidden="true" />
            <p role="alert" className="mt-4 font-medium">訂單暫時無法載入</p>
            <p className="mt-1 text-sm text-muted">{myOrdersIssue === 'backend_missing' ? '請稍後再試。' : '請檢查網路後再試一次。'}</p>
            <button
              type="button" aria-disabled={retrying || undefined} className={`${btnOutline} mt-5 h-11 px-6`}
              onClick={() => { if (retrying) return; setRetrying(true); void refreshMyOrders().finally(() => setRetrying(false)); }}
            >
              重試
            </button>
          </div>
        ) : list.length === 0 ? (
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
                  busy?.id === o.id ? <BusyButton label="取消中…" /> : (
                    <button onClick={() => void act(o.id, 'cancel')} aria-disabled={busy ? true : undefined} className="inline-flex min-h-11 items-center rounded-sm border border-line px-3 text-sm">取消訂單</button>
                  )
                )}
                {o.status === 'shipping' && (
                  busy?.id === o.id ? <BusyButton label="完成中…" /> : (
                    <button onClick={() => void act(o.id, 'complete')} aria-disabled={busy ? true : undefined} className="inline-flex min-h-11 items-center rounded-sm bg-brand px-3 text-sm text-white">完成訂單</button>
                  )
                )}
              </div>
            </footer>
          </article>
        ))}
      </div>
    </div>
  );
}

function BusyButton({ label }: { label: string }) {
  return (
    <span role="status" className="inline-flex min-h-11 items-center gap-1.5 rounded-sm border border-line px-3 text-sm text-muted">
      <LoaderCircle size={16} className="motion-safe:animate-spin" aria-hidden="true" />{label}
    </span>
  );
}
