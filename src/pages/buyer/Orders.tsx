import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronDown, Clock, Hourglass, LoaderCircle, Store, TriangleAlert, WifiOff } from 'lucide-react';
import { useStore } from '../../store/StoreContext';
import LoginRequired from '../../components/auth/LoginRequired';
import { useToast } from '../../components/Toast';
import { accountErrorText, toAccountError } from '../../lib/account/errors';
import { btnOutline, btnPrimary } from '../../components/import/ui';
import LeaveDialog from '../../components/import/LeaveDialog';
import { OrderStateChip } from '../../components/payment/PayTag';
import { useRefreshOnVisible, useReviews } from '../../store/ReviewsContext';
import OrderReviewRow, { OrderReviewRowSkeleton } from '../../components/reviews/OrderReviewRow';
import ProductImage from '../../components/ProductImage';
import EmptyState from '../../components/EmptyState';
import { dateText, money } from '../../lib/format';
import { expireMyPendingOrders, fetchOrderPayments } from '../../lib/payment/api';
import { clockText, msUntil } from '../../lib/payment/countdown';
import { orderPayLineIfOn, orderPayState, pendingBatch, type OrderPayState } from '../../lib/payment/orderView';
import type { OrderPaymentRow } from '../../lib/payment/types';
import { usePaymentConfig } from '../../lib/payment/usePaymentConfig';
import OrderTimeline from '../../components/OrderTimeline';
import type { Order, OrderStatus } from '../../types';

export const STATUS_LABEL: Record<OrderStatus, string> = {
  to_ship: '待出貨', shipping: '運送中', completed: '已完成', cancelled: '已取消',
};

type Tab = OrderStatus | 'all' | 'pending';

const TABS: { id: Tab; label: string }[] = [
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

const isUnfinished = (s: OrderPayState) => s === 'pending' || s === 'confirming';

function OrdersView() {
  const { myOrders, myOrdersState, myOrdersIssue, getShop, cancelMyOrder, completeMyOrder, refreshMyOrders } = useStore();
  const toast = useToast();
  const paymentCfg = usePaymentConfig();
  const [busy, setBusy] = useState<{ id: string; kind: 'cancel' | 'complete' } | null>(null);
  const [retrying, setRetrying] = useState(false);
  const [tab, setTab] = useState<Tab>('all');
  const [openId, setOpenId] = useState<string | null>(null);
  const [payments, setPayments] = useState<OrderPaymentRow[]>([]);
  const [cancelBatch, setCancelBatch] = useState<Order[] | null>(null);
  const [cancelBusy, setCancelBusy] = useState(false);
  const { statusState, statusOf, refreshStatus } = useReviews();

  // 線上付款的付款資訊（待付款、確認中、已付款…）。開關關著時不讀：舊資料庫沒有這支函式，也沒有線上付款訂單
  const refreshPayments = useCallback(async () => {
    if (!paymentCfg.enabled) return;
    try { setPayments(await fetchOrderPayments()); } catch { /* 讀不到：沒有付款資訊的線上單顯示成一般「信用卡」，不會被當成已付款 */ }
  }, [paymentCfg.enabled]);
  useEffect(() => { void refreshPayments(); }, [refreshPayments, myOrders]);

  const payOf = useMemo(() => new Map(payments.map(p => [p.order_id, p])), [payments]);
  const stateOf = useCallback((o: Order) => orderPayState(o.payment, payOf.get(o.id)), [payOf]);
  const unfinished = myOrders.filter(o => isUnfinished(stateOf(o)));
  const showPendingTab = paymentCfg.enabled || unfinished.length > 0;
  const tabs = showPendingTab ? [TABS[0], { id: 'pending' as const, label: unfinished.length > 0 ? `待付款 (${unfinished.length})` : '待付款' }, ...TABS.slice(1)] : TABS;

  const list = myOrders.filter(o => {
    const s = stateOf(o);
    if (tab === 'all') return true;
    if (tab === 'pending') return isUnfinished(s);
    if (tab === 'to_ship') return o.status === 'to_ship' && !isUnfinished(s); // 還沒付完款的線上單狀態雖是 to_ship，不是「待出貨」
    return o.status === tab;
  });
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
  // iOS Safari 返回鍵會還原整頁快照（例如從付款頁回來），畫面可能是舊的
  useEffect(() => {
    const onShow = (e: PageTransitionEvent) => { if (e.persisted) { void refreshMyOrders(true); void refreshPayments(); } };
    window.addEventListener('pageshow', onShow);
    return () => window.removeEventListener('pageshow', onShow);
  }, [refreshMyOrders, refreshPayments]);

  // 待付款逾時：最早的那一筆到期時，作廢自己逾時的單、退庫存，然後重讀
  const nextExpiry = payments.filter(p => p.payment_status === 'pending' && p.pay_expires_at).map(p => Date.parse(p.pay_expires_at!)).sort((a, b) => a - b)[0];
  useEffect(() => {
    if (nextExpiry === undefined) return;
    const t = setTimeout(() => {
      void expireMyPendingOrders().catch(() => undefined).finally(() => { void refreshMyOrders(true); void refreshPayments(); });
    }, msUntil(new Date(nextExpiry).toISOString(), Date.now()) + 500);
    return () => clearTimeout(t);
  }, [nextExpiry, refreshMyOrders, refreshPayments]);

  const cancelErrorText = (e: unknown, kind: 'cancel' | 'complete') => {
    const err = toAccountError(e);
    if (err.code === 'ORDER_STATE_CHANGED') {
      return kind === 'cancel' ? '這筆訂單已經出貨，無法取消。畫面已更新。' : '這筆訂單的狀態已經改變，無法完成。畫面已更新。';
    }
    if (err.code === 'ORDER_PAID_NO_CANCEL') return '這筆訂單已經付款，目前無法自行取消。';
    if (err.code === 'PAYMENT_IN_PROGRESS') return '付款正在處理中，暫時無法取消。';
    return accountErrorText(err, '操作失敗，請稍後再試');
  };

  // 取消、完成：處理中不能重複按；狀態已經變了（賣家剛出貨）時資料庫會回錯誤，說明並讓畫面追上
  const act = async (id: string, kind: 'cancel' | 'complete') => {
    if (busy) return;
    setBusy({ id, kind });
    try {
      await (kind === 'cancel' ? cancelMyOrder(id) : completeMyOrder(id));
    } catch (e) {
      toast(cancelErrorText(e, kind), 'error');
    } finally {
      setBusy(null);
      void refreshPayments();
    }
  };

  // 一起付款的待付款訂單只能一起取消：逐張取消
  const confirmCancelBatch = async () => {
    if (!cancelBatch || cancelBusy) return;
    setCancelBusy(true);
    try {
      for (const o of cancelBatch) await cancelMyOrder(o.id);
      toast('已取消訂單');
    } catch (e) {
      toast(cancelErrorText(e, 'cancel'), 'error');
    } finally {
      setCancelBatch(null);
      setCancelBusy(false);
      void refreshPayments();
    }
  };

  return (
    <div className="mx-auto max-w-4xl md:px-4 md:pt-6">
      <div className="no-scrollbar sticky top-[52px] z-20 flex overflow-x-auto bg-white md:top-[108px] md:rounded-t-md">
        {tabs.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            aria-label={t.id === 'pending' && unfinished.length > 0 ? `待付款，${unfinished.length} 筆` : undefined}
            className={`flex-1 shrink-0 whitespace-nowrap border-b-2 px-4 py-3.5 text-sm ${tab === t.id ? 'border-brand text-brand' : 'border-line'}`}>
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
          <EmptyState icon="🧾" title={tab === 'pending' ? '沒有待付款的訂單' : '還沒有訂單'} action={<Link to="/" className="text-brand">去逛逛</Link>} />
        ) : list.map(o => {
          const pay = payOf.get(o.id);
          const ps = stateOf(o);
          const batch = ps === 'pending' ? pendingBatch(o.id, payments, myOrders) : [o];
          const expired = o.payment === 'ecpay_card' && ps === 'expired';
          return (
            <article key={o.id} className="bg-white md:rounded-md">
              <header className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b border-line px-4 py-3 text-sm">
                <Link to={`/shop/${o.shopId}`} className="flex items-center gap-1.5 font-medium"><Store size={16} />{getShop(o.shopId)?.name}</Link>
                <span className="order-3 w-full font-mono text-xs text-muted md:order-none md:w-auto">訂單編號 {o.orderNo}</span>
                {ps === 'pending' || ps === 'confirming' ? <OrderStateChip kind={ps} /> : expired ? <OrderStateChip kind="expired" /> : <span className="text-brand">{STATUS_LABEL[o.status]}</span>}
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

              {ps === 'pending' && (
                <div className="border-t border-line px-4 py-3">
                  <p className="flex items-start gap-1.5 text-sm">
                    <Clock size={16} className="mt-0.5 shrink-0 text-warning-text" aria-hidden="true" />
                    <span>請在 <span className="font-medium tabular-nums">{clockText(pay?.pay_expires_at)}</span> 前付款，逾時訂單會自動取消。</span>
                  </p>
                  {batch.length > 1 && (
                    <p className="mt-1 pl-[1.375rem] text-sm text-muted">和另外 {batch.length - 1} 筆訂單一起付款，共 {money(batch.reduce((s, x) => s + x.total, 0))}。取消會一起取消這 {batch.length} 筆。</p>
                  )}
                </div>
              )}
              {ps === 'confirming' && (
                <div className="flex items-start gap-2 border-t border-line bg-info-bg px-4 py-3 text-sm">
                  <Hourglass size={16} className="mt-0.5 shrink-0 text-info-text" aria-hidden="true" />
                  <span>正在向綠界科技確認付款結果。確認前無法再次付款，確認後這裡會更新。</span>
                </div>
              )}
              {expired && (
                <p className="border-t border-line px-4 py-3 text-sm text-muted">超過 30 分鐘沒有完成付款，訂單已自動取消，你沒有被請款。</p>
              )}

              {/* 物流進度：買家與賣家看到同一份歷程。還沒付完款的單沒有物流可言 */}
              {!isUnfinished(ps) && !expired && (
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
              )}

              {o.status === 'completed' && (() => {
                const rs = statusOf(o.id);
                if (rs) return <OrderReviewRow status={rs} />;
                // 還沒取得這張單的評價狀態（剛完成、或第一次載入）時先放骨架，取得後才決定要不要顯示
                return statusState === 'loading' || (statusState !== 'error' && checkedKey !== completedKey)
                  ? <OrderReviewRowSkeleton /> : null;
              })()}

              <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-line bg-[#fffefb] px-4 py-3">
                <span>
                  <span className="block text-xs text-muted">{dateText(o.createdAt)}</span>
                  {/* 付款方式一行只在線上付款開關打開時出現；關著時與開關打開前的畫面逐字相同 */}
                  {paymentCfg.enabled && <span className="block text-xs text-muted">{orderPayLineIfOn(true, o.payment, pay)}</span>}
                </span>
                <div className="flex flex-wrap items-center justify-end gap-3">
                  <span className="text-sm">訂單金額 <span className="text-lg text-brand">{money(o.total)}</span></span>
                  {ps === 'pending' && (
                    <div className="flex w-full gap-2 sm:w-auto">
                      <button
                        type="button" onClick={() => setCancelBatch(batch)}
                        className={`${btnOutline} flex-1`}
                      >
                        取消訂單
                      </button>
                      {pay?.group_id && <Link to={`/pay/${pay.group_id}`} className={`${btnPrimary} flex-1`}>重新付款</Link>}
                    </div>
                  )}
                  {o.status === 'to_ship' && !isUnfinished(ps) && (
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
          );
        })}
      </div>

      {cancelBatch && (
        <LeaveDialog
          title={`取消這 ${cancelBatch.length} 筆訂單？`}
          description={cancelBatch.length > 1
            ? `這 ${cancelBatch.length} 筆是一起付款的，只能一起取消。商品庫存會釋放，你沒有被請款。`
            : '商品庫存會釋放，你沒有被請款。'}
          stayLabel="保留訂單" leaveLabel="取消訂單" busy={cancelBusy} busyLabel="取消中…"
          onStay={() => setCancelBatch(null)} onLeave={() => void confirmCancelBatch()}
        />
      )}
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
