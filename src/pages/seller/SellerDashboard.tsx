import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, ChevronRight, PlusCircle, Smartphone } from 'lucide-react';
import { useStore } from '../../store/StoreContext';
import { useAuth } from '../../store/AuthContext';
import { useLoginProvider } from '../../components/auth/useLoginProvider';
import { btnOutline } from '../../components/import/ui';
import { phoneOf, providerLabel } from '../../lib/auth/identity';
import ProductImage from '../../components/ProductImage';
import { money, soldText } from '../../lib/format';
import { getSellerReviewCounts } from '../../lib/reviews/api';
import { useRefreshOnVisible } from '../../store/ReviewsContext';
import PayoutCard from '../../components/payment/PayoutCard';

export default function SellerDashboard() {
  const { myShop, products, shopOrders, user } = useStore();
  const provider = useLoginProvider(user);
  const { providers } = useAuth();
  const shop = myShop!;
  const mine = products.filter(p => p.shopId === shop.id);
  const valid = shopOrders.filter(o => o.status !== 'cancelled');

  const revenue = valid.reduce((s, o) => s + o.total, 0);
  const toShip = shopOrders.filter(o => o.status === 'to_ship').length;
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
  // 待回覆評價：資料庫算好（未回覆、未被隱藏）。null＝載入中或失敗，顯示「–」，不當成 0
  const [unreplied, setUnreplied] = useState<{ n: number | null; failed: boolean }>({ n: null, failed: false });
  const loadUnreplied = () => {
    getSellerReviewCounts().then(
      c => setUnreplied({ n: c.unreplied_count, failed: false }),
      () => setUnreplied(prev => ({ n: prev.n, failed: prev.n === null })),
    );
  };
  useEffect(loadUnreplied, []);
  useRefreshOnVisible(loadUnreplied);

  const top = [...mine].sort((a, b) => b.sold - a.sold).slice(0, 5);

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="break-words text-xl font-bold md:text-2xl">嗨，{shop.name} 👋</h1>
          <p className="text-sm text-muted">這是你的賣場今天的狀況</p>
        </div>
        <Link to="/seller/products/new" className="flex items-center gap-1.5 rounded-sm bg-brand px-4 py-2.5 text-sm text-white hover:bg-brand-dark">
          <PlusCircle size={16} /> 新增商品
        </Link>
      </div>

      <PayoutCard />

      {/* 待辦 */}
      <section className="rounded-lg bg-white p-4 md:p-5">
        <h2 className="font-medium">待辦事項</h2>
        <div className="mt-3 grid grid-cols-2 gap-px overflow-hidden rounded-md bg-line md:grid-cols-5">
          <Todo to="/seller/orders" n={toShip} label="待出貨" highlight={toShip > 0} />
          <Todo to="/seller/orders" n={shopOrders.filter(o => o.status === 'shipping').length} label="運送中" />
          <Todo to="/seller/products" n={active} label="上架中商品" />
          <Todo to="/seller/products" n={lowStock.length} label="庫存偏低" highlight={lowStock.length > 0} />
          <Todo
            to="/seller/reviews?tab=unreplied" n={unreplied.n} label="待回覆評價" highlight={(unreplied.n ?? 0) > 0}
            className="col-span-2 md:col-span-1"
            ariaLabel={unreplied.n === null && unreplied.failed ? '待回覆評價，無法取得數量' : undefined}
          />
        </div>
      </section>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <section className="rounded-lg bg-white p-4 md:p-5">
          <div className="flex flex-wrap items-baseline justify-between gap-x-2">
            <h2 className="font-medium">營收</h2>
            <span className="text-xs text-muted">不含已取消訂單</span>
          </div>
          <p className="mt-2 break-words text-3xl font-semibold text-brand max-[319px]:text-2xl">{money(revenue)}</p>
          <p className="text-xs text-muted">共 {valid.length} 筆訂單</p>
          {/* 窄螢幕（320、手機 200% 字級）7 根長條放不下時，只讓圖表自己橫向捲，不撐開整頁 */}
          <div className="mt-5 overflow-x-auto">
            <div className="flex h-36 min-w-fit items-end gap-2" role="img" aria-label="近 7 天營收長條圖">
              {days.map(d => (
                <div key={d.label} className="flex flex-1 flex-col items-center gap-1.5 whitespace-nowrap">
                  <span className="text-[10px] text-muted">{d.sum ? `$${soldText(d.sum)}` : ''}</span>
                  <div className="w-full max-w-9 rounded-t-sm bg-brand/85 transition-all" style={{ height: `${Math.max(2, (d.sum / peak) * 96)}px` }} />
                  <span className="text-[11px] text-muted">{d.label}</span>
                </div>
              ))}
            </div>
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
                <li key={p.id} className="flex items-center gap-3 max-[319px]:gap-2">
                  <span className={`w-4 shrink-0 text-center text-sm font-semibold ${i < 3 ? 'text-brand' : 'text-muted'}`}>{i + 1}</span>
                  <ProductImage src={p.images[0]} alt="" size="sm" className="w-10 shrink-0 rounded-sm max-[319px]:hidden" />
                  <div className="min-w-0 flex-1">
                    <p className="line-clamp-2 break-words text-sm">{p.title}</p>
                    <p className="mt-0.5 text-xs text-muted">已售 {soldText(p.sold)}</p>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>

      {lowStock.length > 0 && (
        <section className="rounded-lg border border-warning-border bg-warning-bg p-4 md:p-5">
          <h2 className="flex items-center gap-1.5 font-medium text-warning-text"><AlertTriangle size={18} /> 庫存提醒</h2>
          <ul className="mt-2 divide-y divide-warning-border text-sm md:divide-y-0">
            {lowStock.map(p => (
              <li key={p.id}>
                {/* 手機：名稱（最多 2 行）在上、規格 chip 換行排在下；桌機：名稱靠左一行、規格靠右 */}
                <Link to={`/seller/products/${p.id}/edit`} className="block min-h-11 py-2 hover:text-brand md:flex md:items-center md:justify-between md:gap-3 md:py-1">
                  <span className="line-clamp-2 min-w-0 break-words md:line-clamp-1 md:flex-1">{p.title}</span>
                  <ul className="mt-1 flex min-w-0 flex-wrap gap-1.5 md:mt-0 md:max-w-1/2 md:shrink-0 md:justify-end">
                    {p.variants.filter(v => v.stock <= 5).map(v => (
                      <li key={v.id} className="min-w-0 break-words rounded-sm bg-white px-1.5 py-0.5 text-xs text-warning-text">
                        {v.name} <span className="whitespace-nowrap">剩 {v.stock}</span>
                      </li>
                    ))}
                  </ul>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* 還沒有門號才顯示；放在最下面，綁定是自願的，不該每次進後台都被提醒 */}
      {user && !phoneOf(user) && provider && providers.phone && (
        <section className="rounded-md border border-line bg-white p-3">
          <h2 className="text-sm font-medium">登入方式</h2>
          <p className="mt-1 text-sm text-muted">
            {provider === 'google' || provider === 'apple' ? `目前用 ${providerLabel(provider)} 登入。` : ''}
            綁定手機後，在 LINE 裡也能用手機號碼登入這家店。
          </p>
          <Link to="/account/phone" className={`${btnOutline} mt-3 h-11 w-full`}>
            <Smartphone size={16} aria-hidden="true" />綁定手機
          </Link>
        </section>
      )}
    </div>
  );
}

function Todo({ to, n, label, highlight, className = '', ariaLabel }: {
  to: string; n: number | null; label: string; highlight?: boolean; className?: string; ariaLabel?: string;
}) {
  return (
    <Link to={to} aria-label={ariaLabel} className={`group flex min-w-0 flex-col items-center gap-1 bg-white px-1 py-5 text-center transition hover:bg-brand-soft/50 ${className}`}>
      <span className={`break-all text-2xl font-semibold ${n === null ? 'text-muted' : highlight ? 'text-brand' : ''}`}>{n ?? '–'}</span>
      <span className="flex items-center justify-center text-xs text-muted">{label}<ChevronRight size={12} className="opacity-0 transition group-hover:opacity-100" /></span>
    </Link>
  );
}
