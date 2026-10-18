import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link, useBlocker, useLocation, useSearchParams } from 'react-router-dom';
import { Check, Eye, EyeOff, FileSpreadsheet, Loader2, Pencil, PlusCircle, Search, Trash2, X } from 'lucide-react';
import { useStore } from '../../store/StoreContext';
import { useToast } from '../../components/Toast';
import ProductImage from '../../components/ProductImage';
import Pagination, { DEFAULT_PAGE_SIZE, clampPage, parsePage, parseSize, totalPagesOf, type PageSize } from '../../components/Pagination';
import LeaveDialog from '../../components/import/LeaveDialog';
import { btnOutline, btnPrimary, btnPrimaryLg } from '../../components/import/ui';
import { priceRange, soldText } from '../../lib/format';
import { BOTH_FIELDS_NAME, FIELD_NAME, resultNotice, type QuickField } from '../../lib/products/quickEdit';
import { LOW_STOCK } from '../../lib/products/stock';
import type { Product } from '../../types';
import { QuickCellButton, QuickEditBlock } from './QuickEditCell';
import QuickEditSheet from './QuickEditSheet';
import type { SavedInfo } from './useQuickEdit';

type Tab = 'all' | 'active' | 'soldout' | 'hidden';

const TABS: [Tab, string][] = [['all', '全部'], ['active', '架上商品'], ['soldout', '已售完'], ['hidden', '已下架']];
const parseTab = (raw: string | null): Tab => TABS.find(([id]) => id === raw)?.[0] ?? 'all';

const stockOf = (p: Product) => p.variants.reduce((s, v) => s + v.stock, 0);
const hasStockChange = (info: SavedInfo) => info.result.changed.some(c => c.field === 'stock');

type EditKind = QuickField | 'sheet';
const kindName = (kind: EditKind) => (kind === 'sheet' ? BOTH_FIELDS_NAME : FIELD_NAME[kind]);
/** 「已更新」小字停留多久 */
const FLASH_MS = 3000;
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

/** 自動下架／仍是下架的提示條：不自動消失，按 × 或開始下一次快改才收 */
function NoticeBar({ text, onClose }: { text: string; onClose: () => void }) {
  return (
    <div className="rounded-sm border border-warning-border bg-warning-bg px-3 py-2 text-sm">
      <p className="flex items-start gap-2 text-ink">
        <EyeOff size={18} className="mt-0.5 shrink-0 text-warning-text" aria-hidden="true" />
        <span className="min-w-0 flex-1">{text}</span>
        <button
          type="button" aria-label="關閉提示" onClick={onClose}
          className="-my-2 -mr-2 flex h-11 w-11 shrink-0 items-center justify-center text-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
        >
          <X size={16} aria-hidden="true" />
        </button>
      </p>
    </div>
  );
}

// 上下架文字鈕：視覺高 36（lg 32），after 偽元素把點擊區補到 44
const toggleBtn = 'relative inline-flex h-9 shrink-0 items-center justify-center gap-1 whitespace-nowrap self-center rounded-sm border bg-white px-2.5 text-xs font-medium after:absolute after:inset-x-0 after:-inset-y-1 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand motion-safe:active:scale-[0.98] lg:h-8 lg:after:-inset-y-1.5';

export default function SellerProducts() {
  const { myShop, products, loading, loadError, setProductStatus, deleteProduct, reload } = useStore();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const location = useLocation();
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);

  // 快改：同一時間只有一個編輯區（一格，或手機的面板）
  const [active, setActive] = useState<{ productId: string; kind: EditKind } | null>(null);
  const [status, setStatus] = useState({ dirty: false, busy: false });
  const [nag, setNag] = useState(0);
  const [flash, setFlash] = useState<{ productId: string; kind: EditKind } | null>(null);
  const [notice, setNotice] = useState<{ productId: string; kind: EditKind; text: string } | null>(null);
  const [announce, setAnnounce] = useState({ id: 0, text: '' });
  const [focusBack, setFocusBack] = useState<{ productId: string; kind: EditKind; index: number; gone: boolean } | null>(null);

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

  const say = (text: string) => setAnnounce(prev => ({ id: prev.id + 1, text }));

  const closeEdit = useCallback((back: { productId: string; kind: EditKind; index: number; gone: boolean } | null) => {
    setActive(null);
    setStatus({ dirty: false, busy: false });
    setNag(0);
    setFocusBack(back);
  }, []);

  const openEdit = (p: Product, kind: EditKind) => {
    if (status.busy) return;
    if (active && status.dirty) { setNag(n => n + 1); return; }
    setNotice(null);
    setFlash(null);
    setNag(0);
    setStatus({ dirty: false, busy: false });
    setActive({ productId: p.id, kind });
  };

  const cancelEdit = useCallback(() => {
    if (!active) return;
    closeEdit({ productId: active.productId, kind: active.kind, index: rows.findIndex(p => p.id === active.productId), gone: false });
  }, [active, closeEdit, rows]);

  const onSaved = (p: Product, kind: EditKind) => (info: SavedInfo) => {
    const updated: Product = { ...p, variants: info.result.variants, status: info.result.status };
    const total = stockOf(updated);
    const leftTab = tab !== 'all' && !match[tab](updated) ? (updated.status === 'hidden' ? 'hidden' : 'active') : null;
    const outcome = resultNotice({
      autoHidden: info.result.autoHidden, status: updated.status, stockChanged: hasStockChange(info), stockTotal: total, leftTab,
    });
    const index = rows.findIndex(r => r.id === p.id);
    closeEdit({ productId: p.id, kind, index, gone: leftTab !== null });
    if (leftTab !== null) {
      // 這列離開了目前的分頁籤，格子裡的提示會跟著消失，只能用 toast（toast 自己是 role=status，不再另念）
      toast(outcome.text, outcome.kind === 'warn' ? 'info' : 'success');
      return;
    }
    if (outcome.kind === 'warn') {
      setFlash(null);
      setNotice({ productId: p.id, kind, text: outcome.text });
      say(`${p.title}　${outcome.text}`);
      return;
    }
    setNotice(null);
    setFlash({ productId: p.id, kind });
    const changedVariants = new Set(info.changes.map(c => c.variantId)).size;
    const priceChanged = info.changes.some(c => c.field === 'price');
    const stockChanged = hasStockChange(info);
    const what = kindName(priceChanged && stockChanged ? 'sheet' : priceChanged ? 'price' : 'stock');
    const value = p.variants.length > 1 || (priceChanged && stockChanged)
      ? `${what}，共 ${changedVariants} 個規格`
      : priceChanged ? `${what} ${priceRange(updated.variants.map(v => v.price))}` : `${what} ${total}`;
    say(`已更新：${p.title} ${value}`);
  };

  const onGone = (kind: 'not_found' | 'variant_missing') => {
    toast(kind === 'not_found' ? '這件商品已不存在' : '這件商品的規格已被修改，請重新操作', 'error');
    closeEdit(null);
    void reload();
  };

  // 「已更新」小字 3 秒後收起
  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => setFlash(null), FLASH_MS);
    return () => clearTimeout(t);
  }, [flash]);

  // 換頁、換分頁籤、改關鍵字後，上一次的結果提示就不屬於眼前的列了
  useEffect(() => { setNotice(null); setFlash(null); }, [tab, kw, page, size]);

  // 編輯中的商品不在眼前的列表上了（被刪、被重抓）：收掉編輯區
  useEffect(() => {
    if (active && !rows.some(p => p.id === active.productId)) closeEdit(null);
  }, [active, rows, closeEdit]);

  // 桌機格子與手機面板是兩套版面：視窗跨過 1024 時，沒有改動才收掉；有改動就保留（輸入不能因為縮放瀏覽器就丟）。
  // 桌機的編輯區在窄版仍可用（疊在列裡），手機面板在寬版仍可用（置中的面板）。
  const statusRef = useRef(status);
  statusRef.current = status;
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1024px)');
    const onChange = () => { if (!statusRef.current.dirty && !statusRef.current.busy) closeEdit(null); };
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [closeEdit]);

  // 收起編輯區後把焦點還回去：格子（或手機的入口）還在就回它；列已經離開就去原位置的同欄格子、沒有就上一列、再沒有就標題
  useEffect(() => {
    if (!focusBack) return;
    const find = (id: string, kind: EditKind) =>
      document.querySelector<HTMLElement>(kind === 'sheet' ? `[data-qe-entry="${CSS.escape(id)}"]` : `[data-qe-cell="${CSS.escape(`${id}:${kind}`)}"]`);
    // 資料庫的結果與編輯區的收起可能不在同一次渲染：列還在畫面上（還沒被移走）就先等，下一次渲染再來
    if (focusBack.gone && rows.some(p => p.id === focusBack.productId)) return;
    let el = find(focusBack.productId, focusBack.kind);
    if (!el) {
      const neighbour = rows[focusBack.index] ?? rows[focusBack.index - 1];
      el = neighbour ? find(neighbour.id, focusBack.kind) : null;
    }
    (el ?? headingRef.current)?.focus();
    setFocusBack(null);
  }, [focusBack, rows]);

  // 有還沒儲存的修改時離開（換頁、換分頁籤、改關鍵字、翻頁、點側欄、點錯誤訊息裡的編輯頁連結）先確認
  // 送出中不擋：存檔成功時列表資料會比編輯區收起早一個渲染更新，頁碼修正等網址改動不該被誤擋
  const guarded = active !== null && status.dirty && !status.busy;
  const blocker = useBlocker(({ currentLocation, nextLocation }) =>
    guarded && (currentLocation.pathname !== nextLocation.pathname || currentLocation.search !== nextLocation.search));
  useEffect(() => {
    if (!guarded) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [guarded]);
  // 確認框出現時編輯區可能已經收掉（按了面板的取消）：名稱與欄位記在 ref，文字才不會變空白
  const guardInfo = useRef({ title: '', what: '' });
  const guardedProduct = active ? mine.find(p => p.id === active.productId) : undefined;
  if (guardedProduct && active) guardInfo.current = { title: guardedProduct.title, what: kindName(active.kind) };

  return (
    <div className="mx-auto max-w-5xl">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 ref={headingRef} tabIndex={-1} className="text-xl font-bold outline-none">我的商品</h1>
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
          <div className="hidden grid-cols-[1fr_150px_80px_80px_152px] gap-4 bg-[#fafafa] px-4 py-2.5 text-xs text-muted lg:grid">
            <span>商品</span>
            <span className="flex items-center gap-1">價格<Pencil size={11} aria-hidden="true" /></span>
            <span className="flex items-center gap-1">庫存<Pencil size={11} aria-hidden="true" /></span>
            <span>銷量</span><span className="text-right">操作</span>
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
                const multi = p.variants.length > 1;
                const here = active?.productId === p.id ? active.kind : null;
                const editingPrice = here === 'price';
                const editingStock = here === 'stock';
                const edit = { to: `/seller/products/${p.id}/edit`, state: toForm };
                const toggleLabel = p.status === 'active' ? '下架' : '上架';
                const shownNotice = notice?.productId === p.id ? notice : null;
                const updatedKind = flash?.productId === p.id ? flash.kind : null;
                const editArgs = {
                  product: p, onSaved: onSaved(p, here ?? 'price'), onGone, onClose: cancelEdit, onStatusChange: setStatus,
                };
                return (
                  <li key={p.id} className={`grid grid-cols-1 items-center gap-x-4 gap-y-2 px-4 py-3 min-[320px]:grid-cols-[1fr_auto] lg:grid-cols-[1fr_150px_80px_80px_152px] ${multi && here && here !== 'sheet' ? 'lg:items-start' : ''}`}>
                    <div className={`flex min-w-0 items-center gap-3 max-[319px]:flex-col max-[319px]:items-start ${multi && here && here !== 'sheet' ? 'lg:sticky lg:top-[4.5rem] lg:self-start' : ''}`}>
                      <ProductImage src={p.images[0]} alt="" size="sm" className={`w-14 shrink-0 rounded-sm ${p.status === 'hidden' ? 'opacity-40' : ''}`} />
                      <div className="min-w-0">
                        <p className="line-clamp-2 text-sm">{p.title}</p>
                        <p className="mt-0.5 flex flex-wrap gap-1.5 text-xs">
                          {p.status === 'hidden' && <span className="rounded-sm bg-canvas px-1 text-muted">已下架</span>}
                          {stock === 0 && <span className="rounded-sm bg-error-bg px-1 text-error">售完</span>}
                          <span className="text-muted">{p.variants.length} 種規格</span>
                        </p>
                      </div>
                    </div>
                    {editingPrice ? (
                      <QuickEditBlock {...editArgs} field="price" edit={edit} nag={nag} />
                    ) : (
                      <QuickCellButton product={p} field="price" stock={stock} updated={updatedKind === 'price'} onOpen={() => openEdit(p, 'price')} />
                    )}
                    {editingStock ? (
                      <QuickEditBlock {...editArgs} field="stock" edit={edit} nag={nag} />
                    ) : !editingPrice && (
                      <QuickCellButton product={p} field="stock" stock={stock} updated={updatedKind === 'stock'} onOpen={() => openEdit(p, 'stock')} />
                    )}
                    {!editingPrice && !editingStock && <span className="hidden text-sm lg:block">{soldText(p.sold)}</span>}
                    {!editingStock && (
                      <div className="flex justify-end gap-1">
                        <Link to={`/seller/products/${p.id}/edit`} state={toForm} aria-label="編輯" title="編輯" className="rounded-md p-2 text-muted hover:bg-canvas hover:text-brand"><Pencil size={17} /></Link>
                        <button
                          type="button"
                          onClick={async () => {
                            try {
                              await setProductStatus(p.id, p.status === 'active' ? 'hidden' : 'active');
                              toast(p.status === 'active' ? '已下架' : '已重新上架');
                            } catch (e) { toast(e instanceof Error ? e.message : '操作失敗'); }
                          }}
                          className={`${toggleBtn} ${p.status === 'active' ? 'border-line text-muted hover:bg-canvas' : 'border-brand text-brand-dark hover:bg-brand-soft'}`}>
                          {p.status === 'active' ? <EyeOff size={14} aria-hidden="true" /> : <Eye size={14} aria-hidden="true" />}
                          {toggleLabel}
                        </button>
                        <button aria-label="刪除" title="刪除" onClick={() => setConfirmId(p.id)} className="rounded-md p-2 text-muted hover:bg-error-bg hover:text-error"><Trash2 size={17} /></button>
                      </div>
                    )}
                    <div className="col-span-full pl-[68px] max-[319px]:pl-0 lg:hidden">
                      <p className="flex flex-wrap gap-x-4 text-xs text-muted">
                        <span className="text-ink">{priceRange(p.variants.map(v => v.price))}</span>
                        <span className={stock <= LOW_STOCK ? 'text-error-text' : ''}>庫存 {stock}</span>
                        <span>已售 {soldText(p.sold)}</span>
                      </p>
                      {updatedKind === 'sheet' && (
                        <p aria-hidden="true" className="mt-1 flex items-center gap-1 text-xs text-success-text"><Check size={14} />已更新</p>
                      )}
                      <button
                        type="button" data-qe-entry={p.id} onClick={() => openEdit(p, 'sheet')} aria-label={`改價格／庫存：${p.title}`}
                        className={`${btnOutline} mt-2 max-w-full text-left`}
                      >
                        <Pencil size={16} className="shrink-0" aria-hidden="true" />
                        <span className="min-w-0">改價格／庫存</span>
                      </button>
                    </div>
                    {shownNotice && (
                      <>
                        <div className={`hidden lg:block ${shownNotice.kind === 'stock' ? 'lg:col-span-3 lg:col-start-3' : 'lg:col-span-4 lg:col-start-2'}`}>
                          <NoticeBar text={shownNotice.text} onClose={() => setNotice(null)} />
                        </div>
                        <div className="col-span-full pl-[68px] max-[319px]:pl-0 lg:hidden">
                          <NoticeBar text={shownNotice.text} onClose={() => setNotice(null)} />
                        </div>
                      </>
                    )}
                    {here === 'sheet' && (
                      <QuickEditSheet {...editArgs} edit={edit} />
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {!loading && <Pagination page={page} totalPages={totalPages} size={size} total={list.length} onPage={goPage} onSize={goSize} />}
      </div>

      <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        <span key={announce.id}>{announce.text}</span>
      </div>

      {blocker.state === 'blocked' && (() => {
        const dialog = (
          <LeaveDialog
            title="有未儲存的修改，確定離開？"
            description={`「${guardInfo.current.title}」的${guardInfo.current.what}改了還沒儲存，離開後這些修改會消失。`}
            stayLabel="回去儲存" leaveLabel="離開，不儲存"
            onStay={() => blocker.reset()}
            onLeave={() => { blocker.proceed(); closeEdit(null); }}
          />
        );
        // 手機面板開著時 #root 是 inert，確認框要掛到 body 才點得到（面板也在 body，後掛的在上面）
        return active?.kind === 'sheet' ? createPortal(dialog, document.body) : dialog;
      })()}

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
