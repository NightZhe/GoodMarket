import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight, Truck, ShieldCheck, Store } from 'lucide-react';
import { useStore } from '../../store/StoreContext';
import { CATEGORIES } from '../../data/seed';
import ProductCard from '../../components/ProductCard';
import ProductImage from '../../components/ProductImage';
import { cheapestVariant, discountOf, money } from '../../lib/format';

const PAGE = 12;

// 限時特賣先不對外顯示（示範資料用的檔期機制還沒真的做）。改 true 就會回來。
const SHOW_FLASH_SALE = false;

export default function Home() {
  const { products } = useStore();
  const [shown, setShown] = useState(PAGE);
  const active = useMemo(() => products.filter(p => p.status === 'active'), [products]);

  const flash = useMemo(
    () => active.filter(p => discountOf(cheapestVariant(p.variants)) > 0)
      .sort((a, b) => discountOf(cheapestVariant(b.variants)) - discountOf(cheapestVariant(a.variants)))
      .slice(0, 6),
    [active],
  );
  // 每日新發現照銷量排；新上架的另外開一區，才不會被銷量 0 壓到最後面
  const recommended = useMemo(() => [...active].sort((a, b) => b.sold - a.sold), [active]);
  const newest = useMemo(
    () => [...active].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 6),
    [active],
  );

  return (
    <div className="mx-auto max-w-6xl space-y-3 px-0 pt-3 md:space-y-5 md:px-4 md:pt-6">
      {/* 主視覺 */}
      <section className="grid gap-3 px-3 md:grid-cols-3 md:px-0">
        <div className="relative overflow-hidden rounded-md bg-gradient-to-br from-[#ff7a45] via-brand to-[#e2361b] p-6 text-white md:col-span-2 md:p-10">
          <p className="text-xs font-medium tracking-[0.2em] opacity-90">GOODMARKET · 9.9 購物節</p>
          <h1 className="mt-2 text-3xl font-bold leading-tight md:text-5xl">全站滿 $499<br />免運費</h1>
          <p className="relative mt-3 max-w-[13rem] text-sm opacity-90 md:max-w-xs">上千家小店直送，買家安心、賣家好上手。</p>
          <Link to="/search" className="relative mt-5 inline-flex items-center gap-1 rounded-full bg-white px-5 py-2 text-sm font-semibold text-brand transition hover:bg-brand-soft">
            開始逛逛 <ChevronRight size={16} />
          </Link>
          <span aria-hidden className="pointer-events-none absolute -bottom-4 -right-3 select-none text-[6.5rem] md:-bottom-6 md:text-[12rem]">🎁</span>
        </div>
        <Link to="/seller" className="group flex items-center gap-4 rounded-md bg-white p-4 transition hover:shadow-md md:flex-col md:items-stretch md:justify-between md:p-6">
          <Store className="shrink-0 text-brand md:hidden" size={30} strokeWidth={1.6} />
          <div className="min-w-0 flex-1">
            <Store className="hidden text-brand md:block" size={30} strokeWidth={1.6} />
            <h2 className="text-base font-bold md:mt-3 md:text-xl">你也可以開店</h2>
            <p className="mt-0.5 text-xs text-muted md:mt-1 md:text-sm">3 分鐘建立商店，拍照就能上架。0 元開店、不抽上架費。</p>
          </div>
          <span className="inline-flex shrink-0 items-center text-sm font-semibold text-brand md:mt-4">
            <span className="hidden md:inline">前往賣家中心</span><span className="md:hidden">開店</span> <ChevronRight size={16} className="transition group-hover:translate-x-1" />
          </span>
        </Link>
      </section>

      <section className="grid grid-cols-3 gap-px overflow-hidden bg-line text-xs text-muted md:rounded-md">
        <Perk icon={<Truck size={16} />} text="滿 $499 免運" />
        <Perk icon={<ShieldCheck size={16} />} text="7 天鑑賞期" />
        <Perk icon={<Store size={16} />} text="在地小店直送" />
      </section>

      {/* 分類 */}
      <section className="bg-white md:rounded-md">
        <h2 className="border-b border-line px-4 py-3 text-sm font-medium text-muted">分類</h2>
        <div className="grid grid-cols-4 md:grid-cols-8">
          {CATEGORIES.map(c => (
            <Link key={c.id} to={`/search?cat=${c.id}`} className="flex flex-col items-center gap-2 px-1 py-4 transition hover:bg-brand-soft/60">
              <span className="flex h-14 w-14 items-center justify-center rounded-full bg-canvas text-3xl">{c.icon}</span>
              <span className="text-center text-xs">{c.name}</span>
            </Link>
          ))}
        </div>
      </section>

      {/* 限時特賣 */}
      {SHOW_FLASH_SALE && (
      <section className="bg-white md:rounded-md">
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <div className="flex items-center gap-3">
            <h2 className="text-lg font-bold italic text-brand">⚡ 限時特賣</h2>
            <Countdown />
          </div>
          <Link to="/search?sort=discount" className="flex items-center text-sm text-brand">
            看更多 <ChevronRight size={16} />
          </Link>
        </div>
        <div className="no-scrollbar flex gap-2 overflow-x-auto p-3 md:grid md:grid-cols-6 md:overflow-visible">
          {flash.map(p => {
            const price = cheapestVariant(p.variants).price;
            const stock = p.variants.reduce((s, v) => s + v.stock, 0);
            const ratio = Math.min(0.95, p.sold / (p.sold + stock * 20));
            return (
              <Link key={p.id} to={`/product/${p.id}`} className="w-32 shrink-0 text-center md:w-auto">
                <div className="relative overflow-hidden rounded-sm">
                  <ProductImage src={p.images[0]} alt={p.title} className="w-full" />
                  <span className="absolute right-0 top-0 bg-warning px-1 text-[11px] font-semibold text-brand-dark">
                    -{discountOf(cheapestVariant(p.variants))}%
                  </span>
                </div>
                <p className="mt-2 text-lg font-medium text-brand">{money(price)}</p>
                <div className="relative mx-2 mt-1 h-4 overflow-hidden rounded-full bg-[#ffbda6]">
                  <div className="h-full bg-gradient-to-r from-brand to-[#ff8a4c]" style={{ width: `${ratio * 100}%` }} />
                  <span className="absolute inset-0 text-[10px] font-semibold uppercase leading-4 text-white">
                    {ratio > 0.8 ? '即將售完' : '熱賣中'}
                  </span>
                </div>
              </Link>
            );
          })}
        </div>
      </section>
      )}

      {/* 最新上架 */}
      {newest.length > 0 && (
        <section className="bg-white md:rounded-md">
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <h2 className="text-lg font-bold">🆕 最新上架</h2>
            <Link to="/search?sort=newest" className="flex items-center text-sm text-brand">
              看更多 <ChevronRight size={16} />
            </Link>
          </div>
          <div className="grid grid-cols-2 gap-2 p-2 sm:grid-cols-3 md:grid-cols-6 md:gap-2.5">
            {newest.map(p => <ProductCard key={p.id} product={p} />)}
          </div>
        </section>
      )}

      {/* 每日推薦 */}
      <section>
        <h2 className="sticky top-[52px] z-10 border-b-4 border-brand bg-white py-3 text-center font-medium text-brand md:top-[108px] md:rounded-t-md">
          每日新發現
        </h2>
        <div className="grid grid-cols-2 gap-2 p-2 sm:grid-cols-3 md:grid-cols-6 md:gap-2.5 md:px-0">
          {recommended.slice(0, shown).map(p => <ProductCard key={p.id} product={p} />)}
        </div>
        {shown < recommended.length && (
          <div className="flex justify-center py-4">
            <button
              onClick={() => setShown(s => s + PAGE)}
              className="w-72 rounded-sm border border-line bg-white py-2.5 text-sm text-muted transition hover:bg-canvas"
            >
              查看更多
            </button>
          </div>
        )}
      </section>
    </div>
  );
}

function Perk({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <div className="flex items-center justify-center gap-1.5 bg-white py-2.5">
      <span className="text-brand">{icon}</span>
      {text}
    </div>
  );
}

function Countdown() {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  // 每 2 小時一檔特賣
  const left = 7200 - Math.floor(now / 1000) % 7200;
  const parts = [Math.floor(left / 3600), Math.floor(left / 60) % 60, left % 60].map(n => String(n).padStart(2, '0'));
  return (
    <span className="flex gap-1" aria-label="特賣剩餘時間">
      {parts.map((p, i) => (
        <span key={i} className="rounded-sm bg-ink px-1 text-sm font-semibold leading-5 text-white">{p}</span>
      ))}
    </span>
  );
}
