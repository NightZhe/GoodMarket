import { Link } from 'react-router-dom';
import { AlertTriangle, ChevronRight, PlusCircle } from 'lucide-react';
import { useStore } from '../../store/StoreContext';
import ProductImage from '../../components/ProductImage';
import { money, soldText } from '../../lib/format';

export default function SellerDashboard() {
  const { sellerShopId, products, orders, getShop } = useStore();
  const shop = getShop(sellerShopId!)!;
  const mine = products.filter(p => p.shopId === shop.id);
  const myOrders = orders.filter(o => o.shopId === shop.id);
  const valid = myOrders.filter(o => o.status !== 'cancelled');

  const revenue = valid.reduce((s, o) => s + o.total, 0);
  const toShip = myOrders.filter(o => o.status === 'to_ship').length;
  const active = mine.filter(p => p.status === 'active').length;
  const lowStock = mine.filter(p => p.variants.some(v => v.stock <= 5));

  // 近 7 天營收
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - (6 - i));
    const next = d.getTime() + 86400000;
    const sum = valid.filter(o => { const t = Date.parse(o.createdAt); return t >= d.getTime() && t < next; })
      .reduce((s, o) => s + o.total, 0);
    return { label: `${d.getMonth() + 1}/${d.getDate()}`, sum };
  });
  const peak = Math.max(1, ...days.map(d => d.sum));
  const top = [...mine].sort((a, b) => b.sold - a.sold).slice(0, 5);

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold md:text-2xl">嗨，{shop.name} 👋</h1>
          <p className="text-sm text-muted">這是你的賣場今天的狀況</p>
        </div>
        <Link to="/seller/products/new" className="flex items-center gap-1.5 rounded-sm bg-brand px-4 py-2.5 text-sm text-white hover:bg-brand-dark">
          <PlusCircle size={16} /> 新增商品
        </Link>
      </div>

      {/* 待辦 */}
      <section className="rounded-lg bg-white p-4 md:p-5">
        <h2 className="font-medium">待辦事項</h2>
        <div className="mt-3 grid grid-cols-2 gap-px overflow-hidden rounded-md bg-line md:grid-cols-4">
          <Todo to="/seller/orders" n={toShip} label="待出貨" highlight={toShip > 0} />
          <Todo to="/seller/orders" n={myOrders.filter(o => o.status === 'shipping').length} label="運送中" />
          <Todo to="/seller/products" n={active} label="上架中商品" />
          <Todo to="/seller/products" n={lowStock.length} label="庫存偏低" highlight={lowStock.length > 0} />
        </div>
      </section>

      <div className="grid gap-4 md:grid-cols-[1.4fr_1fr]">
        <section className="rounded-lg bg-white p-4 md:p-5">
          <div className="flex items-baseline justify-between">
            <h2 className="font-medium">營收</h2>
            <span className="text-xs text-muted">不含已取消訂單</span>
          </div>
          <p className="mt-2 text-3xl font-semibold text-brand">{money(revenue)}</p>
          <p className="text-xs text-muted">共 {valid.length} 筆訂單</p>
          <div className="mt-5 flex h-36 items-end gap-2" role="img" aria-label="近 7 天營收長條圖">
            {days.map(d => (
              <div key={d.label} className="flex flex-1 flex-col items-center gap-1.5">
                <span className="text-[10px] text-muted">{d.sum ? `$${soldText(d.sum)}` : ''}</span>
                <div className="w-full max-w-9 rounded-t-sm bg-brand/85 transition-all" style={{ height: `${Math.max(2, (d.sum / peak) * 96)}px` }} />
                <span className="text-[11px] text-muted">{d.label}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="rounded-lg bg-white p-4 md:p-5">
          <h2 className="font-medium">熱銷商品</h2>
          {top.length === 0 ? (
            <div className="py-10 text-center text-sm text-muted">
              還沒有商品，<Link to="/seller/products/new" className="text-brand">上架第一件 →</Link>
            </div>
          ) : (
            <ol className="mt-3 space-y-3">
              {top.map((p, i) => (
                <li key={p.id} className="flex items-center gap-3">
                  <span className={`w-4 text-center text-sm font-semibold ${i < 3 ? 'text-brand' : 'text-muted'}`}>{i + 1}</span>
                  <ProductImage src={p.images[0]} alt="" size="sm" className="w-10 rounded-sm" />
                  <p className="min-w-0 flex-1 truncate text-sm">{p.title}</p>
                  <span className="text-xs text-muted">已售 {soldText(p.sold)}</span>
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>

      {lowStock.length > 0 && (
        <section className="rounded-lg border border-amber-200 bg-amber-50 p-4 md:p-5">
          <h2 className="flex items-center gap-1.5 font-medium text-amber-800"><AlertTriangle size={18} /> 庫存提醒</h2>
          <ul className="mt-2 space-y-1.5 text-sm">
            {lowStock.map(p => (
              <li key={p.id}>
                <Link to={`/seller/products/${p.id}/edit`} className="flex items-center justify-between gap-2 hover:text-brand">
                  <span className="truncate">{p.title}</span>
                  <span className="shrink-0 text-xs text-amber-700">
                    {p.variants.filter(v => v.stock <= 5).map(v => `${v.name} 剩 ${v.stock}`).join('、')}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function Todo({ to, n, label, highlight }: { to: string; n: number; label: string; highlight?: boolean }) {
  return (
    <Link to={to} className="group flex flex-col items-center gap-1 bg-white py-5 transition hover:bg-brand-soft/50">
      <span className={`text-2xl font-semibold ${highlight ? 'text-brand' : ''}`}>{n}</span>
      <span className="flex items-center text-xs text-muted">{label}<ChevronRight size={12} className="opacity-0 transition group-hover:opacity-100" /></span>
    </Link>
  );
}
