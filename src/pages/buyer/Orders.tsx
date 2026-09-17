import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Store } from 'lucide-react';
import { useStore } from '../../store/StoreContext';
import ProductImage from '../../components/ProductImage';
import EmptyState from '../../components/EmptyState';
import { dateText, money } from '../../lib/format';
import type { OrderStatus } from '../../types';

export const STATUS_LABEL: Record<OrderStatus, string> = {
  to_ship: '待出貨', shipping: '運送中', completed: '已完成', cancelled: '已取消',
};

const TABS: { id: OrderStatus | 'all'; label: string }[] = [
  { id: 'all', label: '全部' }, { id: 'to_ship', label: '待出貨' }, { id: 'shipping', label: '待收貨' },
  { id: 'completed', label: '完成' }, { id: 'cancelled', label: '不成立' },
];

// 示範版沒有會員系統：「我的訂單」顯示在這台瀏覽器下的單（排除賣家示範訂單）
export default function Orders() {
  const { orders, getShop, updateOrderStatus } = useStore();
  const [tab, setTab] = useState<OrderStatus | 'all'>('all');
  const mine = orders.filter(o => !o.id.startsWith('ord_demo'));
  const list = mine.filter(o => tab === 'all' || o.status === tab);

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
      <div className="mt-2 space-y-2 md:mt-3 md:space-y-3">
        {list.length === 0 ? (
          <EmptyState icon="🧾" title="還沒有訂單" action={<Link to="/" className="text-brand">去逛逛</Link>} />
        ) : list.map(o => (
          <article key={o.id} className="bg-white md:rounded-md">
            <header className="flex items-center justify-between border-b border-line px-4 py-3 text-sm">
              <Link to={`/shop/${o.shopId}`} className="flex items-center gap-1.5 font-medium"><Store size={16} />{getShop(o.shopId)?.name}</Link>
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
            <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-line bg-[#fffefb] px-4 py-3">
              <span className="text-xs text-muted">{dateText(o.createdAt)}</span>
              <div className="flex items-center gap-3">
                <span className="text-sm">訂單金額 <span className="text-lg text-brand">{money(o.total)}</span></span>
                {o.status === 'to_ship' && (
                  <button onClick={() => updateOrderStatus(o.id, 'cancelled')} className="rounded-sm border border-line px-3 py-1.5 text-sm">取消訂單</button>
                )}
                {o.status === 'shipping' && (
                  <button onClick={() => updateOrderStatus(o.id, 'completed')} className="rounded-sm bg-brand px-3 py-1.5 text-sm text-white">完成訂單</button>
                )}
              </div>
            </footer>
          </article>
        ))}
      </div>
    </div>
  );
}
