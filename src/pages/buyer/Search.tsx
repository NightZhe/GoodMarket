import { useEffect, useMemo, useRef } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Check, Filter } from 'lucide-react';
import { useStore } from '../../store/StoreContext';
import { CATEGORIES } from '../../data/seed';
import { CategoryIcon } from '../../data/categoryIcons';
import { orderCategories } from '../../lib/home/categoryOrder';
import ProductCard from '../../components/ProductCard';
import EmptyState from '../../components/EmptyState';
import { pillButton } from '../../components/pillButton';
import { cheapestVariant, discountOf } from '../../lib/format';
import type { Product } from '../../types';

type Sort = 'relevance' | 'newest' | 'sales' | 'price_asc' | 'price_desc' | 'discount';

const minPrice = (p: Product) => Math.min(...p.variants.map(v => v.price));

/** 手機排序列與「免運」共用的小膠囊。外層 h-11 是 44pt 熱區，裡面的膠囊 32 高 */
const pillCls = (on: boolean) =>
  `flex h-8 items-center rounded-full px-3.5 text-footnote transition-colors duration-200 group-active:duration-0 ${
    on
      ? 'bg-press font-semibold text-ink'
      : 'bg-canvas font-medium text-muted group-active:bg-press [@media(hover:hover)_and_(pointer:fine)]:group-hover:bg-press'
  }`;

export default function Search() {
  const { products, shops } = useStore();
  const [params, setParams] = useSearchParams();
  const q = params.get('q')?.trim() ?? '';
  const cat = params.get('cat') ?? '';
  const sort = (params.get('sort') as Sort) || 'relevance';
  const free = params.get('free') === '1';

  const chipsRef = useRef<HTMLDivElement>(null);

  // 從首頁點第 9 類以後進來時，選取的 chip 在螢幕外；進頁與 ?cat= 改變時把它捲到看得見
  useEffect(() => {
    chipsRef.current?.querySelector('[aria-pressed="true"]')?.scrollIntoView({ inline: 'center', block: 'nearest' });
  }, [cat]);

  const chipCategories = useMemo(() => orderCategories(CATEGORIES, products), [products]);

  const set = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value); else next.delete(key);
    setParams(next, { replace: true });
  };

  const results = useMemo(() => {
    const kw = q.toLowerCase();
    const list = products.filter(p => {
      if (p.status !== 'active') return false;
      if (cat && p.categoryId !== cat) return false;
      if (free && !p.freeShipping) return false;
      if (!kw) return true;
      const shopName = shops.find(s => s.id === p.shopId)?.name ?? '';
      return `${p.title} ${p.description} ${shopName}`.toLowerCase().includes(kw);
    });
    const by: Record<Sort, (a: Product, b: Product) => number> = {
      // 綜合只看銷量（決策 A-6）：舊的「銷量 × 評分」用的是從來沒更新過的假評分，改用真實評價後不再乘評分
      relevance: (a, b) => b.sold - a.sold,
      newest: (a, b) => b.createdAt.localeCompare(a.createdAt),
      sales: (a, b) => b.sold - a.sold,
      price_asc: (a, b) => minPrice(a) - minPrice(b),
      price_desc: (a, b) => minPrice(b) - minPrice(a),
      discount: (a, b) => discountOf(cheapestVariant(b.variants)) - discountOf(cheapestVariant(a.variants)),
    };
    return list.sort(by[sort]);
  }, [products, shops, q, cat, sort, free]);

  const sortBtn = (value: Sort, label: string) => (
    <button
      onClick={() => set('sort', value === 'relevance' ? '' : value)}
      aria-pressed={sort === value}
      className="group flex h-11 shrink-0 items-center"
    >
      <span className={pillCls(sort === value)}>{label}</span>
    </button>
  );

  // 空狀態文案（AC-23）：有關鍵字 > 只有分類 > 只有「免運」篩選 > 什麼條件都沒有
  const empty = q
    ? `找不到『${q}』的商品`
    : cat
      ? '這個分類還沒有商品'
      : free
        ? '沒有符合條件的商品'
        : '目前還沒有商品';
  // 已經在沒有任何條件的 /search，再放「看全部商品」只會回到同一頁
  const hasCondition = Boolean(q || cat || free);

  return (
    <div className="mx-auto flex max-w-6xl gap-5 md:px-4 md:pt-6">
      <aside className="hidden w-48 shrink-0 md:block">
        <h2 className="mb-3 flex items-center gap-1.5 font-bold"><Filter size={16} aria-hidden="true" /> 篩選條件</h2>
        <p className="mb-2 text-sm text-muted">分類</p>
        <ul className="space-y-1 text-sm">
          <li><button onClick={() => set('cat', '')} className={!cat ? 'font-semibold text-brand' : '[@media(hover:hover)_and_(pointer:fine)]:hover:text-brand'}>全部分類</button></li>
          {CATEGORIES.map(c => (
            <li key={c.id}>
              <button
                onClick={() => set('cat', c.id)}
                aria-pressed={cat === c.id}
                className={`flex items-center gap-1.5 ${cat === c.id ? 'font-semibold text-brand' : '[@media(hover:hover)_and_(pointer:fine)]:hover:text-brand'}`}
              >
                <CategoryIcon id={c.id} size={16} />
                {c.name}
              </button>
            </li>
          ))}
        </ul>
        <label className="mt-5 flex items-center gap-2 border-t border-line pt-4 text-sm">
          <input type="checkbox" checked={free} onChange={e => set('free', e.target.checked ? '1' : '')} className="accent-brand" />
          只看免運
        </label>
      </aside>

      <section className="min-w-0 flex-1">
        {/* 手機分類膠囊（§4.2）：36 高、熱區 44；選中＝brand 實心＋白字 */}
        <div ref={chipsRef} role="group" aria-label="分類" className="no-scrollbar flex gap-2 -mb-1 overflow-x-auto scroll-px-5 px-5 pb-1 pt-2 md:hidden">
          {[{ id: '' as const, name: '全部' }, ...chipCategories].map(c => {
            const on = cat === c.id;
            return (
              <button
                key={c.id || 'all'}
                onClick={() => set('cat', c.id)}
                aria-pressed={on}
                className="group flex h-11 shrink-0 items-center"
              >
                <span
                  className={`flex h-9 items-center gap-1.5 rounded-full pr-3.5 text-subhead font-medium transition-colors duration-200 group-active:duration-0 ${
                    c.id ? 'pl-2.5' : 'pl-3.5'
                  } ${on ? 'bg-brand text-white group-active:bg-brand-dark' : 'bg-canvas text-ink group-active:bg-press'}`}
                >
                  {c.id && <CategoryIcon id={c.id} size={18} />}
                  {c.name}
                </span>
              </button>
            );
          })}
        </div>

        {q && (
          <p className="px-5 pt-3 text-footnote text-muted md:px-0 md:pt-0">
            「<span className="font-semibold text-ink">{q}</span>」的搜尋結果，共 {results.length} 件
          </p>
        )}

        <div className="no-scrollbar mt-1 flex items-center gap-2 overflow-x-auto px-5 md:mt-3 md:px-0">
          <span className="hidden shrink-0 text-footnote text-muted md:inline">排序</span>
          {sortBtn('relevance', '綜合')}
          {sortBtn('newest', '最新')}
          {sortBtn('sales', '最熱銷')}
          {sortBtn('price_asc', '價格低→高')}
          {sortBtn('price_desc', '價格高→低')}
          <button
            onClick={() => set('free', free ? '' : '1')}
            aria-pressed={free}
            className="group flex h-11 shrink-0 items-center md:hidden"
          >
            <span className={pillCls(free)}>
              {free && <Check size={14} strokeWidth={2.6} className="mr-1" aria-hidden="true" />}
              免運
            </span>
          </button>
        </div>

        {results.length === 0 ? (
          <EmptyState
            title={empty}
            action={hasCondition ? <Link to="/search" className={pillButton}>看全部商品</Link> : undefined}
          />
        ) : (
          <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-5 px-5 pb-4 md:grid-cols-4 md:px-0 lg:grid-cols-5">
            {results.map(p => <ProductCard key={p.id} product={p} />)}
          </div>
        )}
      </section>
    </div>
  );
}
