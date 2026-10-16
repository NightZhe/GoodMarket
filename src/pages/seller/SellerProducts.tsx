import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import { Eye, EyeOff, FileSpreadsheet, Loader2, Pencil, PlusCircle, Search, Trash2 } from 'lucide-react';
import { useStore } from '../../store/StoreContext';
import { useToast } from '../../components/Toast';
import ProductImage from '../../components/ProductImage';
import Pagination, { DEFAULT_PAGE_SIZE, clampPage, parsePage, parseSize, totalPagesOf, type PageSize } from '../../components/Pagination';
import { btnOutline, btnPrimary, btnPrimaryLg } from '../../components/import/ui';
import { priceRange, soldText } from '../../lib/format';
import type { Product } from '../../types';

type Tab = 'all' | 'active' | 'soldout' | 'hidden';

const TABS: [Tab, string][] = [['all', '全部'], ['active', '架上商品'], ['soldout', '已售完'], ['hidden', '已下架']];
const parseTab = (raw: string | null): Tab => TABS.find(([id]) => id === raw)?.[0] ?? 'all';

const stockOf = (p: Product) => p.variants.reduce((s, v) => s + v.stock, 0);
const match: Record<Tab, (p: Product) => boolean> = {
  all: () => true,
  active: p => p.status === 'active' && stockOf(p) > 0,
  soldout: p => stockOf(p) === 0,
  hidden: p => p.status === 'hidden',
};

// 列表狀態（分頁籤、關鍵字、頁碼、每頁筆數）存在網址；預設值不寫進網址，讓網址保持乾淨
const LIST_KEYS = ['tab', 'q', 'page', 'size'] as const;
interface ListState { tab: Tab; q: string; page: number; size: PageSize }

const writeState = (base: URLSearchParams, s: ListState) => {
  const next = new URLSearchParams(base);
  const put = (key: string, value: string, isDefault: boolean) => (isDefault ? next.delete(key) : next.set(key, value));
  put('tab', s.tab, s.tab === 'all');
  put('q', s.q, s.q === '');
  put('page', String(s.page), s.page <= 1);
  put('size', String(s.size), s.size === DEFAULT_PAGE_SIZE);
  return next;
};

export default function SellerProducts() {
  const { myShop, products, loading, loadError, saveProduct, deleteProduct } = useStore();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const location = useLocation();
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const tab = parseTab(params.get('tab'));
  const kw = params.get('q') ?? '';
  const size = parseSize(params.get('size'));

  const mine = useMemo(() => products.filter(p => p.shopId === myShop?.id), [products, myShop?.id]);
  const counts = useMemo(
    () => Object.fromEntries(TABS.map(([id]) => [id, mine.filter(match[id]).length])) as Record<Tab, number>,
    [mine],
  );
  const list = useMemo(() => {
    const needle = kw.trim().toLowerCase();
    return mine.filter(match[tab]).filter(p => p.title.toLowerCase().includes(needle));
  }, [mine, tab, kw]);

  const totalPages = totalPagesOf(list.length, size);
  const page = clampPage(parsePage(params.get('page')), totalPages);
  const from = (page - 1) * size;
  const rows = list.slice(from, from + size);
  const target = mine.find(p => p.id === confirmId);

  const update = (patch: Partial<ListState>, opts?: { flushSync?: boolean }) => {
    setParams(writeState(params, { tab, q: kw, page, size, ...patch }), { replace: true, flushSync: opts?.flushSync });
  };

  // 網址帶了不合法的值，或刪除／下架讓目前頁消失：把網址改成實際顯示的狀態。
  // 資料還沒載完（含登入後重新載入）時總頁數不可信，這時不能改，否則 page=5 會被誤砍成第 1 頁。
  const ready = !loading && !loadError && Boolean(myShop);
  useEffect(() => {
    if (!ready) return;
    const next = writeState(params, { tab, q: kw, page, size });
    const same = LIST_KEYS.every(k => next.get(k) === params.get(k));
    if (!same) setParams(next, { replace: true });
  }, [ready, params, setParams, tab, kw, page, size]);

  // 換頁後把列表頂端捲進畫面（表頭與第一件可見）；列表頂端本來就看得到時不動
  const scrollToList = () => requestAnimationFrame(() => {
    const el = listRef.current;
    if (el && el.getBoundingClientRect().top < 56) {
      window.scrollTo({ top: window.scrollY + el.getBoundingClientRect().top - 64 });
    }
  });
  const goPage = (p: number) => { update({ page: p }); scrollToList(); };
  const goSize = (s: PageSize) => { update({ size: s, page: 1 }); scrollToList(); };

  // 帶著目前的列表網址去編輯／新增頁，存檔後才回得到原本那一頁（見 ProductForm 的 returnTo）
  const toForm = { from: `${location.pathname}${location.search}` };

  return (
    <div className="mx-auto max-w-5xl">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-bold">我的商品</h1>
        <div className="flex flex-wrap items-center gap-2">
          <Link to="/seller/products/import" className={btnOutline}>
            <FileSpreadsheet size={16} aria-hidden="true" /> 從蝦皮匯入
          </Link>
          <Link to="/seller/products/new" state={toForm} className={btnPrimary}>
            <PlusCircle size={16} aria-hidden="true" /> 新增商品
          </Link>
        </div>
      </div>

      <div className="mt-4 rounded-lg bg-white">
        <div className="no-scrollbar flex overflow-x-auto border-b border-line px-2">
          {TABS.map(([id, label]) => (
            <button key={id} onClick={() => update({ tab: id, page: 1 })}
              className={`shrink-0 border-b-2 px-4 py-3 text-sm ${tab === id ? 'border-brand text-brand' : 'border-transparent'}`}>
              {label} <span className="text-muted">({counts[id]})</span>
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 p-3 md:p-4">
          <label className="flex w-full items-center gap-2 rounded-sm border border-line px-3 md:max-w-xs">
            <Search size={16} className="text-muted" />
            <input value={kw} onChange={e => update({ q: e.target.value, page: 1 }, { flushSync: true })} placeholder="搜尋商品名稱" className="h-9 flex-1 text-sm outline-none" />
          </label>
          {!loading && list.length > 0 && (
            <p className="text-sm text-muted" aria-live="polite">{rows.length === 1 ? `第 ${from + 1} 件` : `第 ${from + 1}–${from + rows.length} 件`}，共 {list.length} 件</p>
          )}
        </div>

        <div ref={listRef}>
          <div className="hidden grid-cols-[1fr_150px_80px_80px_120px] gap-4 bg-[#fafafa] px-4 py-2.5 text-xs text-muted md:grid">
            <span>商品</span><span>價格</span><span>庫存</span><span>銷量</span><span className="text-right">操作</span>
          </div>

          {loading || list.length === 0 ? (
            loading ? (
              <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted" role="status">
                <Loader2 size={18} className="animate-spin motion-reduce:animate-none" aria-hidden="true" /> 載入中…
              </div>
            ) : mine.length === 0 ? (
              <div className="flex flex-col items-center gap-3 px-4 py-14 text-center">
                <span className="text-5xl" aria-hidden="true">🛍️</span>
                <p className="text-lg font-medium">還沒有商品</p>
                <p className="max-w-sm text-sm text-muted">有蝦皮賣場的話，可以把商品一次搬過來；商品、規格、庫存、圖片都會帶入。</p>
                <div className="mt-2 flex w-full max-w-xs flex-col gap-2 md:w-auto md:max-w-none md:flex-row">
                  <Link to="/seller/products/import" className={btnPrimaryLg}>從蝦皮匯入商品</Link>
                  <Link to="/seller/products/new" className={`${btnOutline} px-6 text-base`}>手動新增第一件商品</Link>
                </div>
              </div>
            ) : (
              <div className="py-16 text-center text-sm text-muted">沒有符合條件的商品</div>
            )
          ) : (
            <ul className="divide-y divide-line">
              {rows.map(p => {
                const stock = stockOf(p);
                return (
                  <li key={p.id} className="grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-2 px-4 py-3 md:grid-cols-[1fr_150px_80px_80px_120px]">
                    <div className="flex min-w-0 items-center gap-3">
                      <ProductImage src={p.images[0]} alt="" size="sm" className={`w-14 shrink-0 rounded-sm ${p.status === 'hidden' ? 'opacity-40' : ''}`} />
                      <div className="min-w-0">
                        <p className="line-clamp-2 text-sm">{p.title}</p>
                        <p className="mt-0.5 flex gap-1.5 text-xs">
                          {p.status === 'hidden' && <span className="rounded-sm bg-canvas px-1 text-muted">已下架</span>}
                          {stock === 0 && <span className="rounded-sm bg-error-bg px-1 text-error">售完</span>}
                          <span className="text-muted">{p.variants.length} 種規格</span>
                        </p>
                      </div>
                    </div>
                    <span className="hidden text-sm md:block">{priceRange(p.variants.map(v => v.price))}</span>
                    <span className={`hidden text-sm md:block ${stock <= 5 ? 'text-error' : ''}`}>{stock}</span>
                    <span className="hidden text-sm md:block">{soldText(p.sold)}</span>
                    <div className="flex justify-end gap-1">
                      <Link to={`/seller/products/${p.id}/edit`} state={toForm} aria-label="編輯" title="編輯" className="rounded-md p-2 text-muted hover:bg-canvas hover:text-brand"><Pencil size={17} /></Link>
                      <button
                        aria-label={p.status === 'active' ? '下架' : '上架'} title={p.status === 'active' ? '下架' : '上架'}
                        onClick={async () => {
                          try {
                            await saveProduct({ ...p, status: p.status === 'active' ? 'hidden' : 'active' });
                            toast(p.status === 'active' ? '已下架' : '已重新上架');
                          } catch (e) { toast(e instanceof Error ? e.message : '操作失敗'); }
                        }}
                        className="rounded-md p-2 text-muted hover:bg-canvas hover:text-brand">
                        {p.status === 'active' ? <EyeOff size={17} /> : <Eye size={17} />}
                      </button>
                      <button aria-label="刪除" title="刪除" onClick={() => setConfirmId(p.id)} className="rounded-md p-2 text-muted hover:bg-error-bg hover:text-error"><Trash2 size={17} /></button>
                    </div>
                    <p className="col-span-2 flex gap-4 pl-[68px] text-xs text-muted md:hidden">
                      <span className="text-ink">{priceRange(p.variants.map(v => v.price))}</span>
                      <span className={stock <= 5 ? 'text-error' : ''}>庫存 {stock}</span>
                      <span>已售 {soldText(p.sold)}</span>
                    </p>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {!loading && <Pagination page={page} totalPages={totalPages} size={size} total={list.length} onPage={goPage} onSize={goSize} />}
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
              <button
                onClick={async () => {
                  try {
                    await deleteProduct(target.id);
                    toast('已刪除');
                  } catch (e) { toast(e instanceof Error ? e.message : '刪除失敗'); }
                  setConfirmId(null);
                }}
                className="rounded-sm bg-error px-4 py-2 text-sm text-white">刪除</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
