import { useState } from 'react';
import { MapPin, Phone, Truck, User } from 'lucide-react';
import { useStore } from '../../store/StoreContext';
import { useToast } from '../../components/Toast';
import ProductImage from '../../components/ProductImage';
import { STATUS_LABEL } from '../buyer/Orders';
import { dateText, money } from '../../lib/format';
import type { OrderStatus } from '../../types';

const PAY: Record<string, string> = { cod: '貨到付款', card: '信用卡', transfer: 'ATM 轉帳' };
const TONE: Record<OrderStatus, string> = {
  to_ship: 'bg-brand-soft text-brand', shipping: 'bg-info-bg text-info-text',
  completed: 'bg-success-soft text-success-text', cancelled: 'bg-canvas text-muted',
};

export default function SellerOrders() {
  const { sellerShopId, orders, updateOrderStatus } = useStore();
  const toast = useToast();
  const [tab, setTab] = useState<OrderStatus | 'all'>('to_ship');
  const mine = orders.filter(o => o.shopId === sellerShopId);
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
                <span>訂單編號 <span className="font-mono text-ink">{o.id.replace('ord_', '').toUpperCase()}</span></span>
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
              <footer className="flex flex-wrap items-center justify-end gap-3 border-t border-line px-4 py-3">
                <span className="mr-auto text-xs text-muted">{PAY[o.payment]}・運費 {money(o.shippingFee)}</span>
                <span className="text-sm">訂單金額 <span className="text-lg font-medium text-brand">{money(o.total)}</span></span>
                {o.status === 'to_ship' && (
                  <>
                    <button onClick={() => { updateOrderStatus(o.id, 'cancelled'); toast('訂單已取消'); }} className="rounded-sm border border-line px-3 py-2 text-sm hover:bg-canvas">取消訂單</button>
                    <button onClick={() => { updateOrderStatus(o.id, 'shipping'); toast('已安排出貨'); }} className="flex items-center gap-1.5 rounded-sm bg-brand px-4 py-2 text-sm text-white hover:bg-brand-dark">
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
