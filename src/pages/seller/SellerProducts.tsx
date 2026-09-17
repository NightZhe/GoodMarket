import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Eye, EyeOff, Pencil, PlusCircle, Search, Trash2 } from 'lucide-react';
import { useStore } from '../../store/StoreContext';
import { useToast } from '../../components/Toast';
import ProductImage from '../../components/ProductImage';
import { priceRange, soldText } from '../../lib/format';
import type { Product } from '../../types';

type Tab = 'all' | 'active' | 'soldout' | 'hidden';

export default function SellerProducts() {
  const { sellerShopId, products, saveProduct, deleteProduct } = useStore();
  const toast = useToast();
  const [tab, setTab] = useState<Tab>('all');
  const [kw, setKw] = useState('');
  const [confirmId, setConfirmId] = useState<string | null>(null);

  const mine = products.filter(p => p.shopId === sellerShopId);
  const stockOf = (p: Product) => p.variants.reduce((s, v) => s + v.stock, 0);
  const match: Record<Tab, (p: Product) => boolean> = {
    all: () => true,
    active: p => p.status === 'active' && stockOf(p) > 0,
    soldout: p => stockOf(p) === 0,
    hidden: p => p.status === 'hidden',
  };
  const list = mine.filter(match[tab]).filter(p => p.title.toLowerCase().includes(kw.trim().toLowerCase()));

  const TABS: [Tab, string][] = [['all', '全部'], ['active', '架上商品'], ['soldout', '已售完'], ['hidden', '已下架']];
  const target = mine.find(p => p.id === confirmId);

  return (
    <div className="mx-auto max-w-5xl">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-bold">我的商品</h1>
        <Link to="/seller/products/new" className="flex items-center gap-1.5 rounded-sm bg-brand px-4 py-2 text-sm text-white hover:bg-brand-dark">
          <PlusCircle size={16} /> 新增商品
        </Link>
      </div>

      <div className="mt-4 rounded-lg bg-white">
        <div className="no-scrollbar flex overflow-x-auto border-b border-line px-2">
          {TABS.map(([id, label]) => (
            <button key={id} onClick={() => setTab(id)}
              className={`shrink-0 border-b-2 px-4 py-3 text-sm ${tab === id ? 'border-brand text-brand' : 'border-transparent'}`}>
              {label} <span className="text-muted">({mine.filter(match[id]).length})</span>
            </button>
          ))}
        </div>
        <div className="p-3 md:p-4">
          <label className="flex items-center gap-2 rounded-sm border border-line px-3 md:max-w-xs">
            <Search size={16} className="text-muted" />
            <input value={kw} onChange={e => setKw(e.target.value)} placeholder="搜尋商品名稱" className="h-9 flex-1 text-sm outline-none" />
          </label>
        </div>

        <div className="hidden grid-cols-[1fr_150px_80px_80px_120px] gap-4 bg-[#fafafa] px-4 py-2.5 text-xs text-muted md:grid">
          <span>商品</span><span>價格</span><span>庫存</span><span>銷量</span><span className="text-right">操作</span>
        </div>

        {list.length === 0 ? (
          <div className="py-16 text-center text-sm text-muted">
            {mine.length === 0 ? <>還沒有商品。<Link to="/seller/products/new" className="text-brand">上架第一件商品 →</Link></> : '沒有符合條件的商品'}
          </div>
        ) : (
          <ul className="divide-y divide-line">
            {list.map(p => {
              const stock = stockOf(p);
              return (
                <li key={p.id} className="grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-2 px-4 py-3 md:grid-cols-[1fr_150px_80px_80px_120px]">
                  <div className="flex min-w-0 items-center gap-3">
                    <ProductImage src={p.images[0]} alt="" size="sm" className={`w-14 shrink-0 rounded-sm ${p.status === 'hidden' ? 'opacity-40' : ''}`} />
                    <div className="min-w-0">
                      <p className="line-clamp-2 text-sm">{p.title}</p>
                      <p className="mt-0.5 flex gap-1.5 text-xs">
                        {p.status === 'hidden' && <span className="rounded-sm bg-gray-100 px-1 text-muted">已下架</span>}
                        {stock === 0 && <span className="rounded-sm bg-red-50 px-1 text-red-500">售完</span>}
                        <span className="text-muted">{p.variants.length} 種規格</span>
                      </p>
                    </div>
                  </div>
                  <span className="hidden text-sm md:block">{priceRange(p.variants.map(v => v.price))}</span>
                  <span className={`hidden text-sm md:block ${stock <= 5 ? 'text-red-500' : ''}`}>{stock}</span>
                  <span className="hidden text-sm md:block">{soldText(p.sold)}</span>
                  <div className="flex justify-end gap-1">
                    <Link to={`/seller/products/${p.id}/edit`} aria-label="編輯" title="編輯" className="rounded-md p-2 text-muted hover:bg-canvas hover:text-brand"><Pencil size={17} /></Link>
                    <button
                      aria-label={p.status === 'active' ? '下架' : '上架'} title={p.status === 'active' ? '下架' : '上架'}
                      onClick={() => { saveProduct({ ...p, status: p.status === 'active' ? 'hidden' : 'active' }); toast(p.status === 'active' ? '已下架' : '已重新上架'); }}
                      className="rounded-md p-2 text-muted hover:bg-canvas hover:text-brand">
                      {p.status === 'active' ? <EyeOff size={17} /> : <Eye size={17} />}
                    </button>
                    <button aria-label="刪除" title="刪除" onClick={() => setConfirmId(p.id)} className="rounded-md p-2 text-muted hover:bg-red-50 hover:text-red-500"><Trash2 size={17} /></button>
                  </div>
                  <p className="col-span-2 flex gap-4 pl-[68px] text-xs text-muted md:hidden">
                    <span className="text-ink">{priceRange(p.variants.map(v => v.price))}</span>
                    <span className={stock <= 5 ? 'text-red-500' : ''}>庫存 {stock}</span>
                    <span>已售 {soldText(p.sold)}</span>
                  </p>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {target && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-6" role="alertdialog" aria-modal="true">
          <div className="animate-fade absolute inset-0 bg-black/45" onClick={() => setConfirmId(null)} />
          <div className="relative w-full max-w-sm rounded-lg bg-white p-6">
            <h2 className="font-bold">確定刪除這件商品？</h2>
            <p className="mt-2 line-clamp-2 text-sm text-muted">{target.title}</p>
            <p className="mt-1 text-xs text-muted">刪除後無法復原。只是暫時不賣的話，建議改用「下架」。</p>
            <div className="mt-5 flex justify-end gap-2">
              <button onClick={() => setConfirmId(null)} className="rounded-sm border border-line px-4 py-2 text-sm">取消</button>
              <button onClick={() => { deleteProduct(target.id); setConfirmId(null); toast('已刪除'); }} className="rounded-sm bg-red-500 px-4 py-2 text-sm text-white">刪除</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
