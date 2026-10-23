import { useCallback, useMemo, useRef, useState } from 'react';
import { Banknote, CalendarClock, CircleAlert, CircleCheck, CircleDashed, ChevronDown, Clock, CreditCard, Info, MapPin, Phone, Receipt, Truck, User } from 'lucide-react';
import { useStore } from '../../store/StoreContext';
import { useRefreshOnVisible } from '../../store/ReviewsContext';
import { orderActionErrorMessage } from '../../lib/orders/errors';
import LeaveDialog from '../../components/import/LeaveDialog';
import Banner from '../../components/import/Banner';
import { btnOutline } from '../../components/import/ui';
import { SellerBadgeView, StatusBlockView } from '../../components/payment/RefundBlocks';
import { AcceptCancelDialog, RejectCancelDialog, SellerCancelDialog } from '../../components/payment/RefundDialogs';
import { useCancelSummary } from '../../store/CancelSummaryContext';
import { useToast } from '../../components/Toast';
import ProductImage from '../../components/ProductImage';
import OrderTimeline from '../../components/OrderTimeline';
import { STATUS_LABEL } from '../buyer/Orders';
import { dateText, money } from '../../lib/format';
import { FEE_RATES, payoutOf } from '../../lib/payout';
import { sellerCancelUi, sellerPayLabel } from '../../lib/payment/orderView';
import { sellerRefundView, sortPendingFirst } from '../../lib/payment/refundView';
import { payoutView, taipeiToday, type PayoutTone, type PayoutView } from '../../lib/payment/payoutView';
import { sellerCancelFailure } from '../../lib/payment/refundErrors';
import { acceptOrderCancel, fetchSellerOrderPayouts, fetchShopOrderRefunds, rejectOrderCancel, sellerCancelPaidOrder } from '../../lib/payment/api';
import { useOrderRefunds } from '../../lib/payment/useOrderRefunds';
import { useOnline } from '../../lib/useOnline';
import { usePaymentConfig } from '../../lib/payment/usePaymentConfig';
import { useMerchantState } from '../../lib/payment/useMerchant';
import type { PayoutStatus } from '../../lib/payment/types';
import type { Order, OrderStatus, ShippingMilestone } from '../../types';

type SellerDialog = { kind: 'accept' | 'reject' | 'cancel'; order: Order };

const TONE: Record<OrderStatus, string> = {
  to_ship: 'bg-brand-soft text-brand', shipping: 'bg-info-bg text-info-text',
  completed: 'bg-success-soft text-success-text', cancelled: 'bg-canvas text-muted',
};

/** 進帳資訊：賣家這筆訂單實際能拿多少，以及被扣了哪些費用 */
function PayoutPanel({ order }: { order: Order }) {
  const [open, setOpen] = useState(false);
  const p = payoutOf(order);
  const row = (label: string, value: number, opts?: { sub?: boolean; strong?: boolean; tone?: string }) => (
    <div className={`flex items-center justify-between ${opts?.sub ? 'text-xs text-muted' : 'text-sm'}`}>
      <span className={opts?.strong ? 'font-medium' : ''}>{label}</span>
      <span className={`${opts?.strong ? 'font-medium' : ''} ${opts?.tone ?? ''}`}>
        {value < 0 ? `-${money(-value)}` : money(value)}
      </span>
    </div>
  );

  return (
    <div className="border-t border-line px-4 py-3">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-sm">
          <Receipt size={16} className="text-muted" /> 進帳資訊
        </span>
        <button onClick={() => setOpen(!open)} className="flex items-center gap-1 text-sm text-brand">
          {open ? '隱藏入帳明細' : '查看進帳明細'}
          <ChevronDown size={14} className={`transition ${open ? 'rotate-180' : ''}`} />
        </button>
      </div>

      {open && (
        <div className="mt-3 space-y-2 rounded-md bg-canvas p-4">
          {row('訂單金額', p.orderTotal, { strong: true })}
          {row('商品價格', p.itemTotal, { sub: true })}
          {row('買家支付運費', p.buyerShipping, { sub: true })}

          <div className="border-t border-line pt-2">
            {row('成交＆金流手續費', p.feeTotal, { strong: true, tone: 'text-error-text' })}
            {row(`成交手續費（商品價格 ${FEE_RATES.commission * 100}%）`, p.commission, { sub: true })}
            {row(`金流與系統處理費（訂單金額 ${FEE_RATES.payment * 100}%）`, p.payment, { sub: true })}
            {FEE_RATES.service > 0 && row('其他服務費', p.service, { sub: true })}
          </div>

          <div className="flex items-center justify-between border-t border-line pt-2">
            <span className="font-medium">預估訂單進帳</span>
            <span className="text-xl font-medium text-brand">{money(p.net)}</span>
          </div>
          <p className="text-xs text-muted">
            費率為平台設定值；實際進帳以訂單完成後結算為準。運費由買家支付、賣家自行出貨，平台不另外代收。
          </p>
        </div>
      )}

      {!open && (
        <p className="mt-1 text-xs text-muted">
          預估進帳 <span className="text-sm text-brand">{money(p.net)}</span>
          <span className="ml-2">（訂單金額 {money(p.orderTotal)}，手續費 {money(p.feeTotal)}）</span>
        </p>
      )}
    </div>
  );
}

const PAYOUT_TAG: Record<PayoutTone, string> = {
  info: 'bg-info-bg text-info-text', success: 'bg-success-soft text-success-text',
  warning: 'bg-warning-bg text-warning-text', neutral: 'bg-canvas text-ink',
};
const PAYOUT_ICON: Record<PayoutStatus, typeof Clock> = {
  captured: Clock, scheduled: CalendarClock, paid_out: CircleCheck, clawed_back: CircleAlert, updating: CircleDashed,
};

/**
 * 撥款狀態（設計 12.2、撥款對帳規格 8.1）。文字與日期都來自綠界的撥款對帳檔（payoutView），不推算；
 * 狀態靠標籤文字表達（圖示 aria-hidden，顏色不是唯一線索）；日期給讀屏念完整的「10 月 28 日」。
 * 狀態改變不朗讀、沒有動畫
 */
function SettlementBlock({ view }: { view: PayoutView }) {
  const Icon = PAYOUT_ICON[view.status];
  return (
    <div className="mt-3 rounded-md border border-line bg-subtle p-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="text-sm font-medium">撥款狀態</span>
        <span className={`inline-flex min-w-0 items-start gap-1 rounded-sm px-1.5 py-0.5 text-xs font-medium ${PAYOUT_TAG[view.tone]}`}>
          <Icon size={12} className="mt-0.5 shrink-0" aria-hidden="true" />
          <span aria-hidden="true" className="min-w-0 break-words">{view.label}</span>
          <span className="sr-only">{view.labelSr}</span>
        </span>
      </div>
      {view.amountLine && <p className="mt-1.5 text-sm font-medium">{view.amountLine}</p>}
      <p className={`${view.amountLine ? 'mt-0.5' : 'mt-1.5'} text-sm text-muted`}>{view.description}</p>
      {view.updatedLine && <p className="mt-1 text-xs text-muted">{view.updatedLine}</p>}
    </div>
  );
}

const MILESTONES: { code: ShippingMilestone; label: string }[] = [
  { code: 'handed_over', label: '已寄件' },
  { code: 'in_transit', label: '送往物流中心' },
  { code: 'out_for_delivery', label: '配送中' },
  { code: 'arrived_store', label: '送達門市' },
  { code: 'picked_up', label: '買家已取貨' },
];

/**
 * 物流節點：按一下就往歷程追加，買家馬上看得到。已經按過的會變灰。
 * 「買家已取貨」會讓訂單轉成已完成而且改不回來，所以先確認；其他四個節點不用。
 */
function MilestoneButtons({ done, onPick }: {
  done: Set<string>;
  onPick: (code: ShippingMilestone) => Promise<void>;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const pick = async (code: ShippingMilestone) => {
    setBusy(code);
    try { await onPick(code); } finally { setBusy(null); }
  };
  return (
    <div className="mr-auto flex flex-wrap items-center gap-1.5">
      <span className="text-xs text-muted">更新進度</span>
      {MILESTONES.map(m => (
        <button
          key={m.code}
          disabled={done.has(m.code) || busy !== null}
          onClick={() => (m.code === 'picked_up' ? setConfirming(true) : void pick(m.code))}
          className="rounded-full border border-line px-2.5 py-1 text-xs transition hover:border-brand hover:text-brand disabled:border-line disabled:bg-canvas disabled:text-disabled"
        >
          {done.has(m.code) ? `✓ ${m.label}` : m.label}
        </button>
      ))}
      {confirming && (
        <LeaveDialog
          title="確認買家已取貨？"
          description="訂單將轉為已完成，之後無法再更改。"
          stayLabel="取消" leaveLabel="確認已取貨" leaveTone="primary"
          busy={busy !== null} busyLabel="處理中…"
          onStay={() => setConfirming(false)}
          onLeave={async () => { await pick('picked_up'); setConfirming(false); }}
        />
      )}
    </div>
  );
}

/** 回到前景重讀訂單的最短間隔：visibilitychange 與 focus 會接連觸發，快速切換分頁也不該連打資料庫 */
const REFRESH_MIN_GAP_MS = 5000;

const CARRIERS = ['7-ELEVEN 取貨', '全家取貨', '黑貓宅急便', '新竹物流', '郵局寄送', '賣家自送'];

/** 出貨表單：填物流方式與單號，買家就能在訂單裡看到 */
function ShipForm({ onSubmit, onCancel }: {
  onSubmit: (carrier: string, trackingNo: string) => Promise<void>;
  onCancel: () => void;
}) {
  const [carrier, setCarrier] = useState(CARRIERS[0]);
  const [trackingNo, setTrackingNo] = useState('');
  const [busy, setBusy] = useState(false);

  return (
    <div className="border-t border-line bg-brand-soft/40 px-4 py-4">
      <p className="text-sm font-medium">填寫出貨資訊</p>
      <div className="mt-3 flex flex-wrap items-end gap-3">
        <label className="text-sm">
          <span className="text-muted">物流方式</span>
          <select value={carrier} onChange={e => setCarrier(e.target.value)}
            className="mt-1 block w-44 rounded-sm border border-line bg-white px-3 py-2 text-sm outline-none focus:border-ink">
            {CARRIERS.map(c => <option key={c}>{c}</option>)}
          </select>
        </label>
        <label className="text-sm">
          <span className="text-muted">物流單號（選填）</span>
          <input value={trackingNo} onChange={e => setTrackingNo(e.target.value)} placeholder="例如 G37715528536"
            className="mt-1 block w-56 rounded-sm border border-line px-3 py-2 text-sm outline-none focus:border-ink" />
        </label>
        <div className="flex gap-2">
          <button onClick={onCancel} className="rounded-sm border border-line bg-white px-4 py-2 text-sm">取消</button>
          <button
            disabled={busy}
            onClick={async () => { setBusy(true); try { await onSubmit(carrier, trackingNo.trim()); } finally { setBusy(false); } }}
            className="rounded-sm bg-brand px-4 py-2 text-sm text-white hover:bg-brand-dark disabled:bg-disabled"
          >
            確認出貨
          </button>
        </div>
      </div>
      <p className="mt-2 text-xs text-muted">填了單號，買家在「我的訂單」就看得到；沒有單號也可以直接出貨。</p>
    </div>
  );
}

export default function SellerOrders() {
  const { myShop, shopOrders, updateOrderStatus, addOrderEvent, refreshShopOrders } = useStore();
  const toast = useToast();
  const { enabled: payEnabled } = usePaymentConfig();
  const merchantState = useMerchantState(payEnabled);
  const online = useOnline();
  const cancelSummary = useCancelSummary();
  // 取消申請與退款的細節。沒有線上付款訂單、開關也關著時不讀（舊資料庫沒有這支函式，畫面與上線前逐字相同）；退款不跟開關走（R-RF9）
  const hasOnlineOrders = shopOrders.some(o => o.payment === 'ecpay_card');
  const refunds = useOrderRefunds(fetchShopOrderRefunds, payEnabled || hasOnlineOrders);
  const reloadRefunds = refunds.reload;
  // 撥款狀態：整頁的線上付款訂單一次取（AC-R24）。讀不到（斷線、對帳開關關著、舊資料庫沒有這支函式）時畫面維持「撥款資料更新中」，不提示錯誤；斷線時保留上一份
  const onlineOrderIds = useMemo(
    () => shopOrders.filter(o => o.shopId === myShop?.id && o.payment === 'ecpay_card').map(o => o.id),
    [shopOrders, myShop?.id],
  );
  const onlineIdsKey = onlineOrderIds.join(',');
  const fetchPayouts = useCallback(() => fetchSellerOrderPayouts(onlineIdsKey.split(',')), [onlineIdsKey]); // 以編號字串當依賴：訂單內容變動但編號不變時不重打
  const payouts = useOrderRefunds(fetchPayouts, onlineIdsKey !== '');
  const reloadPayouts = payouts.reload;
  const reloadSummary = cancelSummary.reload;
  const [dialog, setDialog] = useState<SellerDialog | null>(null);
  // 操作失敗（多半是畫面資料過期，例如買家剛完成或取消了這張單）：顯示錯誤訊息，並重讀成實際狀態
  // 重讀不等結果：斷線時重讀本身也會卡住，按鈕不能因此一直停在處理中。
  const onActionError = async (e: unknown) => {
    toast(orderActionErrorMessage(e), 'error');
    void refreshShopOrders();
  };
  // 買家可能在自己的裝置上完成或取消訂單：回到前景時靜默重讀（不經過 loading 狀態，畫面與捲動位置不動）
  const lastRefreshAt = useRef(0);
  useRefreshOnVisible(() => {
    const now = Date.now();
    if (now - lastRefreshAt.current < REFRESH_MIN_GAP_MS) return;
    lastRefreshAt.current = now;
    void refreshShopOrders();
    void reloadRefunds();
    void reloadPayouts();
  }, { onFocus: true });
  const [tab, setTab] = useState<OrderStatus | 'all'>('to_ship');
  const [shipId, setShipId] = useState<string | null>(null);   // 正在填出貨資訊的訂單
  const [openId, setOpenId] = useState<string | null>(null);   // 展開歷程的訂單
  const mine = shopOrders.filter(o => o.shopId === myShop?.id);
  // 申請中的訂單排在該分頁最上面，同組內維持原順序（退款設計 5.1）
  const isRequested = (o: Order) => o.status === 'to_ship' && refunds.rows.get(o.id)?.cancel_request?.status === 'pending';
  const list = sortPendingFirst(mine.filter(o => tab === 'all' || o.status === tab), isRequested);
  const today = taipeiToday(Date.now());
  const tabs: (OrderStatus | 'all')[] = ['all', 'to_ship', 'shipping', 'completed', 'cancelled'];

  // 同意、拒絕、取消並退款成功後：重讀訂單、申請與退款、側欄待辦數字；訂單離開了目前的分頁，焦點移到分頁鈕（念出更新後的計數）
  const reloadAll = () => Promise.all([refreshShopOrders(), reloadRefunds(), reloadSummary()]);
  const runRefundAction = async (call: () => Promise<unknown>, okText: string): Promise<string | null> => {
    try {
      await call();
    } catch (e) {
      const f = sellerCancelFailure(e);
      if (f.kind === 'field') return f.text;
      toast(f.text, 'error');
      if (f.reload) void reloadAll();
      if (!f.keepOpen) setDialog(null);
      return null;
    }
    setDialog(null);
    toast(okText);
    await reloadAll();
    document.getElementById(`seller-orders-tab-${tab}`)?.focus();
    return null;
  };

  return (
    <div className="mx-auto max-w-5xl">
      <h1 className="text-xl font-bold">訂單管理</h1>
      {payEnabled && merchantState === 'active' && (
        <p className="mt-2 flex items-start gap-1.5 text-sm text-muted">
          <Info size={16} className="mt-0.5 shrink-0 text-info-text" aria-hidden="true" />線上付款的訂單，買家付款成功後才會出現在這裡。
        </p>
      )}
      <div className="no-scrollbar mt-4 flex overflow-x-auto rounded-t-lg border-b border-line bg-white px-2">
        {tabs.map(t => (
          <button key={t} id={`seller-orders-tab-${t}`} onClick={() => setTab(t)}
            className={`shrink-0 border-b-2 px-4 py-3 text-sm ${tab === t ? 'border-brand text-brand' : 'border-transparent'}`}>
            {t === 'all' ? '全部' : STATUS_LABEL[t]} <span className="text-muted">({mine.filter(o => t === 'all' || o.status === t).length})</span>
          </button>
        ))}
      </div>

      {refunds.status === 'error' && (
        <div className="mt-3">
          <Banner
            kind="warning" role="status" title="取消申請與退款狀態暫時讀不到"
            actions={<button type="button" onClick={() => void reloadRefunds()} className={`${btnOutline} px-4`}>重試</button>}
          >
            畫面上的申請與退款資訊可能不是最新的。
          </Banner>
        </div>
      )}

      {list.length === 0 ? (
        <div className="rounded-b-lg bg-white py-16 text-center text-sm text-muted">
          {tab === 'to_ship' ? '目前沒有待出貨的訂單 🎉' : '沒有訂單'}
        </div>
      ) : (
        <ul className="mt-3 space-y-3">
          {list.map(o => {
            const row = refunds.rows.get(o.id);
            const rv = sellerRefundView({ status: o.status, payment: o.payment, row }, { total: o.total, now: Date.now(), time: dateText });
            // 資料庫還沒有退款函式（舊資料庫）：已付款線上單維持上線前的樣子，沒有取消鈕
            const cancelUi = refunds.status === 'missing' && o.payment === 'ecpay_card' ? 'none' : sellerCancelUi(o.payment, row?.cancel_request);
            const requested = isRequested(o);
            const pv = o.payment === 'ecpay_card' ? payoutView({ orderStatus: o.status, hidePayout: rv.hidePayout, row: payouts.rows.get(o.id) }, { today }) : null;
            return (
            <li key={o.id} className="overflow-hidden rounded-lg bg-white">
              <header className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-line bg-[#fafafa] px-4 py-2.5 text-xs text-muted">
                <span>訂單編號 <span className="font-mono text-ink">{o.orderNo}</span></span>
                <span>{dateText(o.createdAt)}</span>
                {o.payment === 'ecpay_card' && <span className="inline-flex items-center gap-1 text-ink"><CreditCard size={13} aria-hidden="true" />{sellerPayLabel('ecpay_card', payEnabled, rv.refundStatus)}</span>}
                {payEnabled && o.payment === 'cod' && <span className="inline-flex items-center gap-1"><Banknote size={13} aria-hidden="true" />貨到付款</span>}
                {rv.badge ? (
                  <span className="ml-auto flex flex-wrap items-center justify-end gap-1.5">
                    <SellerBadgeView kind={rv.badge} />
                    <span className={`rounded-full px-2 py-0.5 font-medium ${TONE[o.status]}`}>{STATUS_LABEL[o.status]}</span>
                  </span>
                ) : (
                  <span className={`ml-auto rounded-full px-2 py-0.5 font-medium ${TONE[o.status]}`}>{STATUS_LABEL[o.status]}</span>
                )}
              </header>
              <div className="grid gap-4 p-4 md:grid-cols-[1fr_240px]">
                <div>
                  <div className="hidden grid-cols-[32px_1fr_90px_60px_90px] gap-2 border-b border-line pb-2 text-xs text-muted md:grid">
                    <span>編號</span><span>商品</span>
                    <span className="text-right">單價</span>
                    <span className="text-right">數量</span>
                    <span className="text-right">小計</span>
                  </div>
                  {o.lines.map((l, i) => (
                    <div key={l.variantId} className="grid grid-cols-[1fr_90px] items-center gap-2 border-b border-line py-3 last:border-0 md:grid-cols-[32px_1fr_90px_60px_90px]">
                      <span className="hidden text-xs text-muted md:block">{i + 1}</span>
                      <div className="flex min-w-0 items-center gap-3">
                        <ProductImage src={l.image} alt="" size="sm" className="w-12 shrink-0 rounded-sm border border-line" />
                        <div className="min-w-0">
                          <p className="line-clamp-2 text-sm">{l.title}</p>
                          <p className="text-xs text-muted">規格：{l.variantName}</p>
                          <p className="text-xs text-muted md:hidden">{money(l.price)} × {l.qty}</p>
                        </div>
                      </div>
                      <span className="hidden text-right text-sm md:block">{money(l.price)}</span>
                      <span className="hidden text-right text-sm md:block">{l.qty}</span>
                      <span className="text-right text-sm">{money(l.price * l.qty)}</span>
                    </div>
                  ))}
                </div>
                <div className="space-y-1.5 rounded-md bg-canvas p-3 text-xs">
                  <p className="flex items-center gap-1.5"><User size={13} className="text-muted" />{o.buyer.name}</p>
                  <p className="flex items-center gap-1.5"><Phone size={13} className="text-muted" />{o.buyer.phone}</p>
                  <p className="flex items-start gap-1.5"><MapPin size={13} className="mt-0.5 shrink-0 text-muted" />{o.buyer.address}</p>
                </div>
              </div>
              {rv.block && (
                <StatusBlockView block={rv.block} variant="seller" id={`refund-status-${o.id}`} card={null}>
                  {requested && row?.cancel_request && (
                    <>
                      <div className="flex flex-col gap-2 pt-2 min-[480px]:flex-row">
                        <button
                          type="button" aria-disabled={!online || undefined} aria-label={`拒絕，訂單 ${o.orderNo}`}
                          onClick={online ? () => setDialog({ kind: 'reject', order: o }) : undefined}
                          className={`${btnOutline} flex-1 min-[480px]:flex-none`}
                        >
                          拒絕
                        </button>
                        <button
                          type="button" aria-disabled={!online || undefined} aria-label={`同意取消並退款，訂單 ${o.orderNo}`}
                          onClick={online ? () => setDialog({ kind: 'accept', order: o }) : undefined}
                          className={`${btnOutline} flex-1 min-[480px]:flex-none`}
                        >
                          同意取消並退款
                        </button>
                      </div>
                      {!online && <p className="text-sm text-muted">目前沒有網路連線，連上網路後才能操作。</p>}
                    </>
                  )}
                </StatusBlockView>
              )}

              <div className="border-t border-line px-4 py-3">
                <button onClick={() => setOpenId(openId === o.id ? null : o.id)}
                  className="flex w-full items-center justify-between text-sm">
                  <span className="flex items-center gap-1.5">
                    🚚 <span className="text-muted">運送進度</span>
                    {o.trackingNo && <span className="font-mono text-xs text-success-text"># {o.trackingNo}</span>}
                  </span>
                  <ChevronDown size={16} className={`text-muted transition ${openId === o.id ? 'rotate-180' : ''}`} />
                </button>
                {openId === o.id && <div className="mt-3"><OrderTimeline order={o} /></div>}
              </div>

              {/* 預估進帳是示範費率（D23 未定）：線上付款訂單不顯示，撥款以綠界算好的金額為準（D42）；退款中、已退款的單也不顯示（退款設計 5.3） */}
              {o.payment !== 'ecpay_card' && !rv.hidePayout && <PayoutPanel order={o} />}
              {pv && <div className="border-t border-line px-4 pb-3"><SettlementBlock view={pv} /></div>}
              {payEnabled && o.payment === 'cod' && (
                <p className="flex items-start gap-1.5 border-t border-line px-4 py-2.5 text-xs text-muted">
                  <Info size={14} className="mt-0.5 shrink-0" aria-hidden="true" />貨到付款：買家收貨時直接付款給你，不經過好物集，也不會有撥款。
                </p>
              )}

              {shipId === o.id && o.status === 'to_ship' && !requested && (
                <ShipForm
                  onCancel={() => setShipId(null)}
                  onSubmit={async (carrier, trackingNo) => {
                    try {
                      await updateOrderStatus(o.id, 'shipping', { carrier, trackingNo });
                    } catch (e) {
                      await onActionError(e);
                      return;
                    }
                    setShipId(null);
                    setOpenId(o.id);
                    toast('已安排出貨');
                  }}
                />
              )}

              <footer className="flex flex-wrap items-center justify-end gap-3 border-t border-line px-4 py-3">
                <span className="mr-auto text-xs text-muted">{sellerPayLabel(o.payment, payEnabled, rv.refundStatus)}・運費 {money(o.shippingFee)}</span>
                <span className="text-sm">訂單金額 <span className="text-lg font-medium text-brand">{money(o.total)}</span></span>
                {o.status === 'shipping' && (
                  <MilestoneButtons
                    done={new Set(o.events.map(e => e.status))}
                    onPick={async code => {
                      try {
                        await addOrderEvent(o.id, code);
                      } catch (e) {
                        await onActionError(e);
                        return;
                      }
                      toast('已更新物流進度');
                      setOpenId(o.id);
                    }}
                  />
                )}
                {o.status === 'to_ship' && (
                  <>
                    {cancelUi === 'direct' && <button onClick={async () => {
                      try {
                        await updateOrderStatus(o.id, 'cancelled');
                      } catch (e) {
                        await onActionError(e);
                        return;
                      }
                      toast('訂單已取消');
                    }} className="min-h-11 rounded-sm border border-line px-3 text-sm hover:bg-canvas">取消訂單</button>}
                    {cancelUi === 'refund' && (
                      <button
                        type="button" aria-disabled={!online || undefined} aria-label={`取消並退款，訂單 ${o.orderNo}`}
                        onClick={online ? () => setDialog({ kind: 'cancel', order: o }) : undefined}
                        className={btnOutline}
                      >
                        取消並退款
                      </button>
                    )}
                    <button
                      onClick={requested ? undefined : () => setShipId(shipId === o.id ? null : o.id)}
                      aria-disabled={requested || undefined} aria-describedby={requested ? `ship-hint-${o.id}` : undefined}
                      className="flex min-h-11 items-center gap-1.5 rounded-sm bg-brand px-4 text-sm text-white hover:bg-brand-dark aria-disabled:cursor-not-allowed aria-disabled:bg-disabled aria-disabled:hover:bg-disabled"
                    >
                      <Truck size={16} /> 安排出貨
                    </button>
                    {requested && <p id={`ship-hint-${o.id}`} className="w-full text-balance text-right text-sm text-muted">買家申請取消中，請先同意或拒絕，才能安排出貨。</p>}
                    {!online && cancelUi === 'refund' && <p className="w-full text-balance text-right text-sm text-muted">目前沒有網路連線，連上網路後才能操作。</p>}
                  </>
                )}
              </footer>
            </li>
            );
          })}
        </ul>
      )}

      {dialog?.kind === 'accept' && (() => {
        const q = refunds.rows.get(dialog.order.id)?.cancel_request;
        return q ? (
          <AcceptCancelDialog
            total={dialog.order.total} reason={q.reason} note={q.note}
            onStay={() => setDialog(null)}
            onConfirm={async () => { await runRefundAction(() => acceptOrderCancel(dialog.order.id), '已同意取消，退款處理中'); }}
          />
        ) : null;
      })()}
      {dialog?.kind === 'reject' && (
        <RejectCancelDialog
          onClose={() => setDialog(null)}
          onSubmit={reason => runRefundAction(() => rejectOrderCancel(dialog.order.id, reason), '已拒絕取消申請，請安排出貨')}
        />
      )}
      {dialog?.kind === 'cancel' && (
        <SellerCancelDialog
          total={dialog.order.total} onClose={() => setDialog(null)}
          onSubmit={(reason, note) => runRefundAction(() => sellerCancelPaidOrder(dialog.order.id, reason, note), '已取消訂單，退款處理中')}
        />
      )}
    </div>
  );
}
