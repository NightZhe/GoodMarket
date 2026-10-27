import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { PackageX, RotateCw, Store, Trash2, Truck, WifiOff } from 'lucide-react';
import { useStore } from '../../store/StoreContext';
import LoginRequired from '../../components/auth/LoginRequired';
import Banner from '../../components/import/Banner';
import { btnOutline } from '../../components/import/ui';
import { useToast } from '../../components/Toast';
import ProductImage from '../../components/ProductImage';
import QtyStepper from '../../components/QtyStepper';
import EmptyState from '../../components/EmptyState';
import Clauses from '../../components/checkout/Clauses';
import { cartMarks, cartStockNote, defaultSelected, readPriceCheckState } from '../../lib/account/priceCheck';
import { GlassTray, TrayButton } from '../../components/glass';
import { money } from '../../lib/format';
import type { CartItem } from '../../types';
import { TRAY_RIGHT_HALF } from './trayPlacement';

const keyOf = (c: Pick<CartItem, 'productId' | 'variantId'>) => `${c.productId}|${c.variantId}`;

/** 購物車（帳號版）：要先登入，內容存在帳號，換裝置也看得到（D15） */
export default function Cart() {
  return (
    <LoginRequired kind="cart">
      <CartView />
    </LoginRequired>
  );
}

function CartSkeleton() {
  return (
    <div aria-busy="true" className="mx-auto max-w-[600px] pb-(--tray-clearance) md:max-w-6xl md:px-4 md:pt-6">
      <p role="status" className="sr-only">載入中</p>
      <div className="space-y-2 md:space-y-4" aria-hidden="true">
        {[0, 1].map(i => (
          <div key={i} className="bg-white md:rounded-md">
            <div className="border-b border-line px-4 py-3"><div className="h-4 w-28 rounded-sm bg-line motion-safe:animate-pulse" /></div>
            <div className="flex gap-3 px-4 py-4">
              <span className="h-20 w-20 shrink-0 rounded-sm bg-line motion-safe:animate-pulse" />
              <div className="flex-1 space-y-2 pt-1">
                <div className="h-3.5 w-3/4 rounded-sm bg-line motion-safe:animate-pulse" />
                <div className="h-3 w-1/3 rounded-sm bg-line motion-safe:animate-pulse" />
                <div className="h-3 w-1/4 rounded-sm bg-line motion-safe:animate-pulse" />
              </div>
            </div>
          </div>
        ))}
      </div>
      {/* 結帳托盤照常顯示，但總額不用粗黑字：避免讓人以為購物車真的是 0 */}
      <div className={`lg:hidden ${TRAY_RIGHT_HALF}`}>
        <GlassTray label="結帳" variant="checkout">
          <div className="col-span-2 flex min-w-0 flex-wrap items-center justify-between gap-x-2" aria-hidden="true">
            <span className="flex min-h-11 items-center gap-2 text-callout text-muted-2">
              <input type="checkbox" disabled className="size-5" tabIndex={-1} />全選
            </span>
            <p className="ml-auto text-right text-footnote text-muted">總金額 $ 0</p>
          </div>
          <TrayButton tone="primary" disabled>去買單 (0)</TrayButton>
        </GlassTray>
      </div>
    </div>
  );
}

function CartView() {
  const { cart, cartState, cartIssue, cartSyncFailed, cartUpdateTick, refreshCart, retryCartSync, getProduct, getShop, setCartQty, removeFromCart, reload } = useStore();
  const navigate = useNavigate();
  const location = useLocation();
  const toast = useToast();
  // 從結帳失敗畫面帶回來的內容（D-7a＝D）：只存在元件裡，讀完立刻清掉 history 的 state，
  // 離開購物車或按上一頁回來都不會重現（AC-29、design.md 5.5）
  const [priceCheck] = useState(() => readPriceCheckState(location.state));
  const [selected, setSelected] = useState<Set<string>>(() => new Set(defaultSelected(cart.map(keyOf), priceCheck)));
  const [retrying, setRetrying] = useState(false);

  // 別台裝置改了購物車、這裡背景重讀後有變：畫面已經會更新，另外對讀屏宣告一聲（只在進頁之後發生的變動）
  const firstTick = useRef(cartUpdateTick);
  const [announce, setAnnounce] = useState('');
  useEffect(() => {
    if (cartUpdateTick === firstTick.current) return;
    setAnnounce('購物車已更新');
    const t = setTimeout(() => setAnnounce(''), 3000);
    return () => clearTimeout(t);
  }, [cartUpdateTick]);
  const liveRegion = <p role="status" aria-live="polite" className="sr-only">{announce}</p>;

  // 進購物車頁就靜默重讀一次：別台裝置改過的內容，不必等到切換分頁才看得到（R-6）
  useEffect(() => { void refreshCart(true); }, [refreshCart]);

  // 商品資料也靜默重讀（D-7i＝B）：畫面維持現有資料、不閃骨架，讀完價格有變就直接顯示新價；
  // 讀不到（離線、網路不穩）就保留現有資料，購物車照常可用
  useEffect(() => { void reload({ silent: true }); }, [reload]);

  const marks = useMemo(() => (priceCheck ? cartMarks(priceCheck.changes) : null), [priceCheck]);
  useEffect(() => {
    if (priceCheck) navigate(location.pathname, { replace: true, state: null });
    // 只在進頁時清一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 依商店分組，並帶出商品與規格資料。商品下架或規格不見的列不能直接藏起來（使用者會不知道購物車少了東西），
  // 另外列成「已失效」，可以刪除、不計入已選件數與總額
  const { groups, invalid } = useMemo(() => {
    const map = new Map<string, { item: CartItem; title: string; image: string; variantName: string; price: number; stock: number }[]>();
    const gone: { item: CartItem; title: string | null }[] = [];
    for (const item of cart) {
      const p = getProduct(item.productId);
      const v = p?.variants.find(x => x.id === item.variantId);
      if (!p || p.status !== 'active' || !v) {
        gone.push({ item, title: p?.title ?? null });
        continue;
      }
      const rows = map.get(p.shopId) ?? [];
      rows.push({ item, title: p.title, image: p.images[0], variantName: v.name, price: v.price, stock: v.stock });
      map.set(p.shopId, rows);
    }
    return { groups: [...map.entries()], invalid: gone };
  }, [cart, getProduct]);

  // 別台裝置新加的品項預設勾選；使用者已經取消勾選的維持原狀。從失敗畫面回來時同樣只勾送出結帳的品項
  const known = useRef(new Set(cart.map(keyOf)));
  useEffect(() => {
    const fresh = cart.map(keyOf).filter(k => !known.current.has(k));
    if (fresh.length === 0) return;
    fresh.forEach(k => known.current.add(k));
    setSelected(prev => new Set([...prev, ...defaultSelected(fresh, priceCheck)]));
  }, [cart, priceCheck]);

  const run = (p: Promise<void>, failMessage: string) => { p.catch(() => toast(failMessage, 'error')); };
  const allRows = groups.flatMap(([, rows]) => rows);
  const chosen = allRows.filter(r => selected.has(keyOf(r.item)) && r.stock > 0);
  const total = chosen.reduce((s, r) => s + r.price * r.item.qty, 0);
  const count = chosen.reduce((s, r) => s + r.item.qty, 0);

  const goCheckout = () =>
    navigate('/checkout', { state: { items: chosen.map(r => r.item), fromCart: true } });

  const toggle = (keys: string[], on: boolean) =>
    setSelected(prev => {
      const next = new Set(prev);
      keys.forEach(k => (on ? next.add(k) : next.delete(k)));
      return next;
    });

  const listReady = cartState !== 'idle' && cartState !== 'loading' && cartState !== 'error' && (groups.length > 0 || invalid.length > 0);
  // 標示出現時焦點移到頂端提示，讀屏會唸出「剛才的結帳沒有成立」（design.md 5.1）
  const noticeRef = useRef<HTMLDivElement>(null);
  const noticeFocused = useRef(false);
  useEffect(() => {
    if (!marks || !listReady || noticeFocused.current) return;
    noticeFocused.current = true;
    noticeRef.current?.focus();
  }, [marks, listReady]);

  if (cartState === 'idle' || cartState === 'loading') return <CartSkeleton />;

  if (cartState === 'error') {
    return (
      <div className="mx-auto max-w-md px-4 py-20 text-center">
        <WifiOff size={40} className="mx-auto text-muted" aria-hidden="true" />
        <p role="alert" className="mt-4 font-medium">購物車暫時無法使用</p>
        <p className="mt-1 text-sm text-muted">{cartIssue === 'backend_missing' ? '請稍後再試。' : '請檢查網路後再試一次。'}</p>
        <button
          type="button" aria-disabled={retrying || undefined} className={`${btnOutline} mt-5 h-11 px-6`}
          onClick={() => { if (retrying) return; setRetrying(true); void refreshCart().finally(() => setRetrying(false)); }}
        >
          重試
        </button>
      </div>
    );
  }

  if (allRows.length === 0 && invalid.length === 0) {
    return (
      <div className="mx-auto max-w-6xl p-3 md:p-6">
        {liveRegion}
        <EmptyState title="購物車還是空的" description="你在其他裝置加入的商品，登入後也會出現在這裡。" action={
          <Link to="/" className="rounded-sm bg-brand px-8 py-2.5 text-white">去逛逛</Link>
        } />
      </div>
    );
  }

  const allKeys = allRows.map(r => keyOf(r.item));
  const allOn = allKeys.every(k => selected.has(k));

  return (
    <div className="mx-auto max-w-[600px] pb-(--tray-clearance) md:max-w-6xl md:px-4 md:pt-6 lg:pb-10">
      {liveRegion}
      <h1 className="hidden text-xl font-medium md:block">購物車</h1>

      {/* 桌機：左清單 + 右側訂單摘要（手機用底部固定列） */}
      <div className="md:mt-4 lg:grid lg:grid-cols-[1fr_320px] lg:items-start lg:gap-4">
      <div className="min-w-0 space-y-2 md:space-y-4">
        {marks && (
          <div className="px-2 pt-2 md:px-0 md:pt-0">
            <div ref={noticeRef} tabIndex={-1} className="outline-none">
              <Banner kind="warning" role="status" title="剛才的結帳沒有成立">
                <Clauses text="有變動的地方已在下面標出，確認後再按「去買單」。" />
              </Banner>
            </div>
          </div>
        )}
        {cartSyncFailed && (
          <div className="px-2 pt-2 md:px-0 md:pt-0">
            <Banner
              kind="warning" role="status" title="購物車暫時無法同步"
              actions={
                <button type="button" className={btnOutline} onClick={() => void retryCartSync()}>
                  <RotateCw size={16} aria-hidden="true" />重試
                </button>
              }
            >
              你剛剛的修改還沒存到帳號。連上網路後再試一次。
            </Banner>
          </div>
        )}
        {groups.map(([shopId, rows]) => {
          const shop = getShop(shopId);
          const keys = rows.map(r => keyOf(r.item));
          const shipNote = marks?.shops.get(shopId);
          return (
            <section key={shopId} className="bg-white md:rounded-md">
              <header className="flex items-center gap-3 border-b border-line px-4 py-3">
                <input type="checkbox" aria-label="全選此商店" className="h-4 w-4 accent-brand" checked={keys.every(k => selected.has(k))} onChange={e => toggle(keys, e.target.checked)} />
                <Link to={`/shop/${shopId}`} className="flex items-center gap-1.5 text-sm font-medium">
                  <Store size={16} /> {shop?.name}
                </Link>
              </header>
              {shipNote && (
                <p className="flex items-start gap-2 border-b border-line bg-warning-bg px-4 py-2 text-xs leading-5 text-ink">
                  <Truck size={16} className="mt-0.5 shrink-0 text-warning-text" aria-hidden="true" />
                  <span className="min-w-0"><Clauses text={shipNote} /></span>
                </p>
              )}
              {rows.map(r => {
                const mark = marks?.items.get(keyOf(r.item));
                const stockNote = cartStockNote(Boolean(mark?.stock), r.item.qty, r.stock);
                return (
                  <div key={keyOf(r.item)} className="flex items-center gap-3 border-b border-line px-4 py-4 last:border-0">
                    <input type="checkbox" aria-label="選取" className="h-4 w-4 shrink-0 accent-brand" disabled={r.stock === 0}
                      checked={selected.has(keyOf(r.item)) && r.stock > 0} onChange={e => toggle([keyOf(r.item)], e.target.checked)} />
                    <Link to={`/product/${r.item.productId}`} className="w-20 shrink-0 overflow-hidden rounded-sm border border-line">
                      <ProductImage src={r.image} alt={r.title} size="sm" className="w-full" />
                    </Link>
                    <div className="min-w-0 flex-1 md:grid md:grid-cols-[1fr_120px_140px_110px_50px] md:items-center md:gap-4">
                      <div className="min-w-0">
                        <p className="line-clamp-2 text-sm">{r.title}</p>
                        <p className="mt-1 w-fit rounded-sm bg-canvas px-1.5 text-xs text-muted">規格：{r.variantName}</p>
                        {r.stock === 0 && <p className="mt-1 text-xs text-error-text">此規格已售完</p>}
                        {mark?.price && <p className="mt-1.5 w-fit max-w-full rounded-sm bg-warning-bg px-1.5 py-0.5 text-xs leading-5 text-ink"><Clauses text={mark.price} /></p>}
                        {stockNote && <p className="mt-1.5 w-fit max-w-full rounded-sm bg-warning-bg px-1.5 py-0.5 text-xs leading-5 text-ink"><Clauses text={stockNote} /></p>}
                      </div>
                      <p className="mt-1 text-brand md:mt-0 md:text-center md:text-ink">{money(r.price)}</p>
                      <div className="mt-2 flex items-center justify-between md:mt-0 md:justify-center">
                        <QtyStepper value={r.item.qty} max={Math.max(1, r.stock)} onChange={n => run(setCartQty(r.item.productId, r.item.variantId, n), '更新購物車失敗，已還原')} />
                        <button onClick={() => run(removeFromCart([r.item]), '更新購物車失敗，已還原')} aria-label="刪除" className="p-2 text-muted md:hidden"><Trash2 size={18} /></button>
                      </div>
                      <p className="hidden text-center text-brand md:block">{money(r.price * r.item.qty)}</p>
                      <button onClick={() => run(removeFromCart([r.item]), '更新購物車失敗，已還原')} className="hidden text-sm hover:text-brand md:block">刪除</button>
                    </div>
                  </div>
                );
              })}
            </section>
          );
        })}
        {invalid.length > 0 && (
          <section className="bg-white md:rounded-md" aria-label="已失效的商品">
            {invalid.map(({ item, title }) => (
              <div key={keyOf(item)} className="flex items-center gap-3 border-b border-line px-4 py-4 last:border-0">
                <input type="checkbox" aria-label="已失效，無法選取" className="h-4 w-4 shrink-0 accent-brand opacity-40" disabled checked={false} readOnly />
                <span className="flex h-20 w-20 shrink-0 items-center justify-center rounded-sm bg-canvas text-muted" aria-hidden="true"><PackageX size={24} /></span>
                <div className="min-w-0 flex-1">
                  {title && <p className="line-clamp-2 text-sm text-muted">{title}</p>}
                  <p className="text-xs text-muted">這個商品已下架或不存在</p>
                  <button
                    type="button" className={`${btnOutline} mt-2 px-3`}
                    onClick={() => run(removeFromCart([item]), '更新購物車失敗，已還原')}
                  >
                    <Trash2 size={16} aria-hidden="true" />從購物車刪除
                  </button>
                </div>
              </div>
            ))}
          </section>
        )}
      </div>

        {/* 桌機：右側訂單摘要卡 */}
        <aside className="sticky top-28 hidden rounded-md bg-white p-5 lg:block">
          <h2 className="font-medium">訂單摘要</h2>
          <dl className="mt-4 space-y-3 text-sm">
            <div className="flex items-center justify-between">
              <dt className="text-muted">已選 {count} 件商品</dt>
              <dd>{money(total)}</dd>
            </div>
            <div className="flex items-center justify-between border-t border-line pt-3">
              <dt className="text-muted">總金額</dt>
              <dd className="text-2xl text-brand">{money(total)}</dd>
            </div>
          </dl>
          <button
            disabled={!count}
            onClick={goCheckout}
            className="mt-4 h-11 w-full rounded-sm bg-brand text-white transition hover:bg-brand-dark disabled:bg-disabled"
          >
            去買單 ({count})
          </button>
          <div className="mt-3 flex items-center justify-between text-sm">
            <label className="flex items-center gap-2">
              <input type="checkbox" className="h-4 w-4 accent-brand" checked={allOn} onChange={e => toggle(allKeys, e.target.checked)} />
              全選
            </label>
            <button
              onClick={() => run(removeFromCart(chosen.map(r => r.item)), '更新購物車失敗，已還原')}
              disabled={!chosen.length}
              className="text-muted hover:text-brand disabled:text-disabled"
            >
              刪除選取
            </button>
          </div>
        </aside>
      </div>

      {/* 手機：底部懸浮結帳托盤（C5）。桌機（lg 以上）用右側訂單摘要卡 */}
      <div className={`lg:hidden ${TRAY_RIGHT_HALF}`}>
        <GlassTray label="結帳" variant="checkout">
          {/* 全選與總金額合成一格橫跨前兩欄：文字放大到放不下時它們自己換行，按鈕留在右側不被擠出托盤 */}
          <div className="col-span-2 flex min-w-0 flex-wrap items-center justify-between gap-x-2">
            <label className="flex min-h-11 items-center gap-2 text-callout text-ink">
              <input type="checkbox" className="size-5 accent-brand" checked={allOn} onChange={e => toggle(allKeys, e.target.checked)} />
              全選
            </label>
            <p className="ml-auto text-right">
              <span className="block text-footnote text-muted">總金額</span>
              <span className="block text-headline font-bold text-ink">{money(total)}</span>
            </p>
          </div>
          <TrayButton tone="primary" disabled={!count} onClick={goCheckout}>去買單 ({count})</TrayButton>
        </GlassTray>
      </div>
    </div>
  );
}
