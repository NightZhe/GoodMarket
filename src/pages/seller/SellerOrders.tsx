import { useState } from 'react';
import { ChevronDown, MapPin, Phone, Receipt, Truck, User } from 'lucide-react';
import { useStore } from '../../store/StoreContext';
import { useToast } from '../../components/Toast';
import ProductImage from '../../components/ProductImage';
import OrderTimeline from '../../components/OrderTimeline';
import { STATUS_LABEL } from '../buyer/Orders';
import { dateText, money } from '../../lib/format';
import { FEE_RATES, payoutOf } from '../../lib/payout';
import type { Order, OrderStatus, ShippingMilestone } from '../../types';

const PAY: Record<string, string> = { cod: '貨到付款', card: '信用卡', transfer: 'ATM 轉帳' };
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

const MILESTONES: { code: ShippingMilestone; label: string }[] = [
  { code: 'handed_over', label: '已寄件' },
  { code: 'in_transit', label: '送往物流中心' },
  { code: 'out_for_delivery', label: '配送中' },
  { code: 'arrived_store', label: '送達門市' },
  { code: 'picked_up', label: '買家已取貨' },
];

/** 物流節點：按一下就往歷程追加，買家馬上看得到。已經按過的會變灰 */
function MilestoneButtons({ done, onPick }: {
  done: Set<string>;
  onPick: (code: ShippingMilestone) => Promise<void>;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  return (
    <div className="mr-auto flex flex-wrap items-center gap-1.5">
      <span className="text-xs text-muted">更新進度</span>
      {MILESTONES.map(m => (
        <button
          key={m.code}
          disabled={done.has(m.code) || busy !== null}
          onClick={async () => { setBusy(m.code); try { await onPick(m.code); } finally { setBusy(null); } }}
          className="rounded-full border border-line px-2.5 py-1 text-xs transition hover:border-brand hover:text-brand disabled:border-line disabled:bg-canvas disabled:text-disabled"
        >
          {done.has(m.code) ? `✓ ${m.label}` : m.label}
        </button>
      ))}
    </div>
  );
}

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
  const { myShop, shopOrders, updateOrderStatus, addOrderEvent } = useStore();
  const toast = useToast();
  const [tab, setTab] = useState<OrderStatus | 'all'>('to_ship');
  const [shipId, setShipId] = useState<string | null>(null);   // 正在填出貨資訊的訂單
  const [openId, setOpenId] = useState<string | null>(null);   // 展開歷程的訂單
  const mine = shopOrders.filter(o => o.shopId === myShop?.id);
  const list = mine.filter(o => tab === 'all' || o.status === tab);
  const tabs: (OrderStatus | 'all')[] = ['all', 'to_ship', 'shipping', 'completed', 'cancelled'];

  return (
    <div className="mx-auto max-w-5xl">
      <h1 className="text-xl font-bold">訂單管理</h1>
      <div className="no-scrollbar mt-4 flex overflow-x-auto rounded-t-lg border-b border-line bg-white px-2">
        {tabs.map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`shrink-0 border-b-2 px-4 py-3 text-sm ${tab === t ? 'border-brand text-brand' : 'border-transparent'}`}>
            {t === 'all' ? '全部' : STATUS_LABEL[t]} <span className="text-muted">({mine.filter(o => t === 'all' || o.status === t).length})</span>
          </button>
        ))}
      </div>

      {list.length === 0 ? (
        <div className="rounded-b-lg bg-white py-16 text-center text-sm text-muted">
          {tab === 'to_ship' ? '目前沒有待出貨的訂單 🎉' : '沒有訂單'}
        </div>
      ) : (
        <ul className="mt-3 space-y-3">
          {list.map(o => (
            <li key={o.id} className="overflow-hidden rounded-lg bg-white">
              <header className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-line bg-[#fafafa] px-4 py-2.5 text-xs text-muted">
                <span>訂單編號 <span className="font-mono text-ink">{o.orderNo}</span></span>
                <span>{dateText(o.createdAt)}</span>
                <span className={`ml-auto rounded-full px-2 py-0.5 font-medium ${TONE[o.status]}`}>{STATUS_LABEL[o.status]}</span>
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

              <PayoutPanel order={o} />

              {shipId === o.id && (
                <ShipForm
                  onCancel={() => setShipId(null)}
                  onSubmit={async (carrier, trackingNo) => {
                    await updateOrderStatus(o.id, 'shipping', { carrier, trackingNo });
                    setShipId(null);
                    setOpenId(o.id);
                    toast('已安排出貨');
                  }}
                />
              )}

              <footer className="flex flex-wrap items-center justify-end gap-3 border-t border-line px-4 py-3">
                <span className="mr-auto text-xs text-muted">{PAY[o.payment]}・運費 {money(o.shippingFee)}</span>
                <span className="text-sm">訂單金額 <span className="text-lg font-medium text-brand">{money(o.total)}</span></span>
                {o.status === 'shipping' && (
                  <MilestoneButtons
                    done={new Set(o.events.map(e => e.status))}
                    onPick={async code => { await addOrderEvent(o.id, code); toast('已更新物流進度'); setOpenId(o.id); }}
                  />
                )}
                {o.status === 'to_ship' && (
                  <>
                    <button onClick={async () => { await updateOrderStatus(o.id, 'cancelled'); toast('訂單已取消'); }} className="rounded-sm border border-line px-3 py-2 text-sm hover:bg-canvas">取消訂單</button>
                    <button onClick={() => setShipId(shipId === o.id ? null : o.id)} className="flex items-center gap-1.5 rounded-sm bg-brand px-4 py-2 text-sm text-white hover:bg-brand-dark">
                      <Truck size={16} /> 安排出貨
                    </button>
                  </>
                )}
              </footer>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
