import { useState } from 'react';
import { ChevronDown, MapPin, Phone, Truck, User } from 'lucide-react';
import { useStore } from '../../store/StoreContext';
import { useToast } from '../../components/Toast';
import ProductImage from '../../components/ProductImage';
import OrderTimeline from '../../components/OrderTimeline';
import { STATUS_LABEL } from '../buyer/Orders';
import { dateText, money } from '../../lib/format';
import type { OrderStatus } from '../../types';

const PAY: Record<string, string> = { cod: '貨到付款', card: '信用卡', transfer: 'ATM 轉帳' };
const TONE: Record<OrderStatus, string> = {
  to_ship: 'bg-brand-soft text-brand', shipping: 'bg-info-bg text-info-text',
  completed: 'bg-success-soft text-success-text', cancelled: 'bg-canvas text-muted',
};

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
  const { myShop, shopOrders, updateOrderStatus } = useStore();
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
                <div className="space-y-3">
                  {o.lines.map(l => (
                    <div key={l.variantId} className="flex items-center gap-3">
                      <ProductImage src={l.image} alt="" size="sm" className="w-12 rounded-sm border border-line" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm">{l.title}</p>
                        <p className="text-xs text-muted">{l.variantName}</p>
                      </div>
                      <span className="text-sm text-muted">×{l.qty}</span>
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
