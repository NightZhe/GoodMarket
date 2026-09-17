import { useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Filter } from 'lucide-react';
import { useStore } from '../../store/StoreContext';
import { CATEGORIES } from '../../data/seed';
import ProductCard from '../../components/ProductCard';
import EmptyState from '../../components/EmptyState';
import type { Product } from '../../types';

type Sort = 'relevance' | 'newest' | 'sales' | 'price_asc' | 'price_desc' | 'discount';

const minPrice = (p: Product) => Math.min(...p.variants.map(v => v.price));

export default function Search() {
  const { products, shops } = useStore();
  const [params, setParams] = useSearchParams();
  const q = params.get('q')?.trim() ?? '';
  const cat = params.get('cat') ?? '';
  const sort = (params.get('sort') as Sort) || 'relevance';
  const free = params.get('free') === '1';

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
      relevance: (a, b) => b.sold * b.rating - a.sold * a.rating,
      newest: (a, b) => b.createdAt.localeCompare(a.createdAt),
      sales: (a, b) => b.sold - a.sold,
      price_asc: (a, b) => minPrice(a) - minPrice(b),
      price_desc: (a, b) => minPrice(b) - minPrice(a),
      discount: (a, b) => (minPrice(a) / (a.originalPrice ?? minPrice(a))) - (minPrice(b) / (b.originalPrice ?? minPrice(b))),
    };
    return list.sort(by[sort]);
  }, [products, shops, q, cat, sort, free]);

  const sortBtn = (value: Sort, label: string) => (
    <button
      onClick={() => set('sort', value === 'relevance' ? '' : value)}
      className={`shrink-0 rounded-sm px-3.5 py-1.5 text-sm transition ${sort === value ? 'bg-brand text-white' : 'bg-white text-ink hover:bg-brand-soft'}`}
    >
      {label}
    </button>
  );

  return (
    <div className="mx-auto flex max-w-6xl gap-5 md:px-4 md:pt-6">
      <aside className="hidden w-48 shrink-0 md:block">
        <h2 className="mb-3 flex items-center gap-1.5 font-bold"><Filter size={16} /> 篩選條件</h2>
        <p className="mb-2 text-sm text-muted">分類</p>
        <ul className="space-y-1 text-sm">
          <li><button onClick={() => set('cat', '')} className={!cat ? 'font-semibold text-brand' : 'hover:text-brand'}>全部分類</button></li>
          {CATEGORIES.map(c => (
            <li key={c.id}>
              <button onClick={() => set('cat', c.id)} className={cat === c.id ? 'font-semibold text-brand' : 'hover:text-brand'}>
                {c.icon} {c.name}
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
        {/* 手機分類 chips */}
        <div className="no-scrollbar flex gap-2 overflow-x-auto bg-white px-3 py-2.5 md:hidden">
          {[{ id: '', name: '全部', icon: '' }, ...CATEGORIES].map(c => (
            <button
              key={c.id || 'all'}
              onClick={() => set('cat', c.id)}
              className={`shrink-0 rounded-full border px-3 py-1 text-xs ${cat === c.id ? 'border-brand bg-brand-soft text-brand' : 'border-line text-ink'}`}
            >
              {c.icon} {c.name}
            </button>
          ))}
        </div>

        {q && (
          <p className="px-3 pt-3 text-sm text-muted md:px-0 md:pt-0">
            「<span className="text-brand">{q}</span>」的搜尋結果，共 {results.length} 件
          </p>
        )}

        <div className="no-scrollbar mt-2 flex items-center gap-2 overflow-x-auto bg-[#ededed] px-3 py-2.5 md:mt-3 md:rounded-sm md:px-4">
          <span className="hidden shrink-0 text-sm text-muted md:inline">排序</span>
          {sortBtn('relevance', '綜合')}
          {sortBtn('newest', '最新')}
          {sortBtn('sales', '最熱銷')}
          {sortBtn('price_asc', '價格低→高')}
          {sortBtn('price_desc', '價格高→低')}
          <label className="flex shrink-0 items-center gap-1.5 text-sm md:hidden">
            <input type="checkbox" checked={free} onChange={e => set('free', e.target.checked ? '1' : '')} className="accent-brand" />
            免運
          </label>
        </div>

        {results.length === 0 ? (
          <div className="p-3 md:px-0"><EmptyState icon="🔍" title="找不到相關商品，換個關鍵字試試" /></div>
        ) : (
          <div className="grid grid-cols-2 gap-2 p-2 sm:grid-cols-3 md:grid-cols-5 md:px-0 md:py-3">
            {results.map(p => <ProductCard key={p.id} product={p} />)}
          </div>
        )}
      </section>
    </div>
  );
}
