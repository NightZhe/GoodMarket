import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Link, Outlet, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { ChevronLeft, CircleUserRound, ClipboardList, House, Search as SearchIcon, Share, ShoppingCart, Store } from 'lucide-react';
import { useStore } from '../../store/StoreContext';
import { useAuth } from '../../store/AuthContext';
import { useToast } from '../../components/Toast';
import { usePaymentConfig } from '../../lib/payment/usePaymentConfig';
import { useOnline } from '../../lib/useOnline';
import { headerFor, type ShareTarget } from '../../lib/layout/headerKind';
import { isNative } from '../../lib/native/platform';
import { publicUrl } from '../../lib/share/publicUrl';
import { pillButtonPrimary } from '../../components/pillButton';
import { scrollPageToTop } from '../../lib/ui/scroll';
import { usePosture } from '../../lib/layout/posture';
import { CountBadge, GlassButton, GlassCapsule, TabPill, type TabItem } from '../../components/glass';

export default function BuyerLayout() {
  const { cartCount, loading, loadError, reload } = useStore();
  usePaymentConfig(); // 先讀一次線上付款開關，之後帳號頁、結帳頁不必再等
  const online = useOnline();
  // 只有第一次載入商品時用骨架取代頁面。登入、登出、登入過期之後的重新載入是在背景進行：
  // 頁面若被卸載，結帳頁填到一半的收件資料就會消失（登入過期時要能留著，AC-13）
  const loadedOnce = useRef(false);
  if (!loading) loadedOnce.current = true;
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [params] = useSearchParams();
  const [q, setQ] = useState(params.get('q') ?? '');

  useEffect(() => setQ(params.get('q') ?? ''), [params]);

  // 從背景回來（§3.4）：靜默重讀，失敗就保留畫面上的資料。頁面不重掛，捲動與橫滑位置自然保留
  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === 'visible') void reload({ silent: true }); };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [reload]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    navigate(`/search?q=${encodeURIComponent(q.trim())}`);
  };

  // 商品頁、結帳頁在手機上有自己的底部操作列，不顯示全站導覽
  // 評價表單（/orders/:id/review）手機底部有自己的送出列，也不顯示全站導覽
  // 地址新增／編輯頁（/account/addresses/new、/account/addresses/:id）有鍵盤，固定的底部分頁在 iOS Safari 鍵盤開關時會跳
  const hideTabBar = pathname.startsWith('/product/') || pathname === '/checkout' || pathname === '/cart'
    || /^\/orders\/[^/]+\/review$/.test(pathname) || pathname.startsWith('/account/addresses/')
    // 綁卡頁有鍵盤（綠界欄位）、付款結果頁要專心看結果
    || pathname === '/account/payment-methods/new' || pathname === '/account/payment-methods/result' || pathname.startsWith('/pay/');

  const header = headerFor(pathname);
  // 「我的」不需要商品資料（登入狀態它自己處理），商品還在載入時也直接顯示，不擋
  const needsProducts = pathname !== '/account' && !pathname.startsWith('/account/');
  // 載入骨架依路由：商品頁（導覽列帶分享鈕的那一種）＝主圖＋標題＋停用的購買列，其餘＝首頁形狀
  const skeleton = header.kind === 'nav' && header.share?.kind === 'product' ? 'product' : 'home';
  // 「我的」頁與它的子頁（都是 SubPage 灰底分組版面）：頁首安全區條、tab bar 與整頁底色都跟著換（子頁不算進去的話，App 內白色安全區條接灰色導覽列會有一條明顯接縫）
  const grouped = pathname === '/account' || pathname.startsWith('/account/');
  const material = grouped ? 'material-grouped' : 'material';

  const tabs = buyerTabs(pathname === '/');

  return (
    <div className={`app-shell flex min-h-dvh flex-col ${grouped ? 'bg-canvas' : ''}`}>
      {/* 唯一一直釘在頂端的東西：蓋住狀態列／動態島的材質條（桌機高度為 0） */}
      <div aria-hidden="true" className={`${material} sticky top-0 z-40 h-[env(safe-area-inset-top)] shrink-0`} />

      {header.kind === 'large' && (
        <header className="mx-auto w-full max-w-6xl">
          <div className="flex h-[52px] items-end justify-between px-5">
            <h1 className="text-large-title font-bold">{header.title}</h1>
            <div className="flex items-end gap-5">
              <DesktopLinks className="mb-2.5" />
              {header.cart && <CartTool count={cartCount} />}
            </div>
          </div>
          {header.search && (pathname === '/search'
            ? <SearchForm q={q} setQ={setQ} onSubmit={submit} />
            : <SearchLink />)}
        </header>
      )}

      {header.kind === 'nav' && (
        <header className={`${material} sticky top-[env(safe-area-inset-top)] z-40`}>
          <div className="mx-auto flex h-11 max-w-6xl items-center justify-between pl-2 pr-1.5 md:px-5">
            <Link to={header.back.to} aria-label={`返回${header.back.label}`} className={`${PRESS_FADE} -ml-1 flex h-11 items-center pr-3 text-body text-brand`}>
              <ChevronLeft size={28} strokeWidth={2.4} aria-hidden="true" />
              {header.back.label}
            </Link>
            <div className="flex items-center">
              <DesktopLinks className="mr-4" />
              {header.share && <ShareButton target={header.share} />}
              {header.cart && <CartNavLink count={cartCount} />}
            </div>
          </div>
        </header>
      )}

      {header.kind === 'plain' && (
        // 帳號子頁自己有導覽列；桌機沒有 tab bar，所以這裡留一條回首頁與常用連結
        <div className="mx-auto hidden h-11 w-full max-w-6xl items-center justify-between px-5 md:flex">
          <Link to="/" className="text-headline font-bold">好物集</Link>
          <DesktopLinks />
        </div>
      )}

      <div role="status">
        {!online && (
          <p className="bg-canvas px-5 py-2 text-center text-footnote text-muted">目前離線，顯示的是上次載入的內容</p>
        )}
      </div>

      <main className={`flex-1 ${hideTabBar ? '' : 'pb-(--tabs-clearance) md:pb-0'}`}>
        {loadError && needsProducts ? (
          <div role="alert" className="mx-auto max-w-md px-5 py-24 text-center">
            <p className="text-title3 font-bold">載入商品失敗</p>
            <p className="mt-1 break-words text-subhead text-muted">{loadError}</p>
            <button
              type="button"
              onClick={() => void reload()}
              className={`${pillButtonPrimary} mt-6`}
            >
              重新載入
            </button>
          </div>
        ) : loading && !loadedOnce.current && needsProducts ? (
          <LoadingSkeleton kind={skeleton} />
        ) : (
          <Outlet />
        )}
      </main>

      <footer className="mt-10 hidden border-t border-line bg-white md:block">
        <div className="mx-auto grid max-w-6xl grid-cols-3 gap-8 px-4 py-10 text-sm text-muted">
          <div>
            <p className="mb-3 font-semibold text-ink">客服中心</p>
            <p>購物說明・退貨退款・聯絡客服</p>
          </div>
          <div>
            <p className="mb-3 font-semibold text-ink">關於好物集</p>
            <p>人人都能開店的購物平台。任何人都能免費開店，上架的商品全站買家都看得到。</p>
          </div>
          <div>
            <p className="mb-3 font-semibold text-ink">成為賣家</p>
            <Link to="/seller" className="text-brand hover:underline">前往賣家中心，免費上架 →</Link>
          </div>
        </div>
      </footer>

      {/* 水平姿態＝置中懸浮膠囊，側邊姿態＝右（左）側直立軌；兩個元件自己看姿態，同一時間只有一個出現。桌機網頁（md 以上）沒有分頁導覽 */}
      {!hideTabBar && (
        <>
          <TabPill items={tabs} label="主要分頁" className="md:hidden" />
          <GlassCapsule label="主要分頁" tabs={tabs} />
        </>
      )}
    </div>
  );
}

/** 按下時淡到 50%，放開 200ms 淡回。要在 iPhone Safari 顯示 :active，需要 main.tsx 的 touchstart 監聽（R1） */
const PRESS_FADE = 'transition-opacity duration-200 active:opacity-50 active:duration-0';

/**
 * 首頁、逛逛的購物車（Q2）：44pt 懸浮玻璃鈕，捲動時不捲走。
 * 水平姿態固定在右上（env(top)＋4、離右緣 16，靜止時在大標題列右側）；側邊姿態搬進直立軌的工具組，與系統欄零重疊。
 * 桌機網頁（md 以上）維持原本頁首裡的 36pt 灰圓鈕。
 */
function CartTool({ count }: { count: number }) {
  const bars = usePosture();
  const cart = (floating: boolean) => (
    <GlassButton
      to="/cart"
      label={`購物車，${count} 件`}
      icon={<ShoppingCart size={22} strokeWidth={1.7} />}
      badge={count}
      className={floating ? 'fixed right-[calc(var(--inset-r)+16px)] top-[calc(env(safe-area-inset-top)+4px)] md:hidden' : ''}
    />
  );
  return bars === 'bottom'
    ? <>{cart(true)}<CartCircle count={count} /></>
    : <GlassCapsule label="頁面工具">{cart(false)}</GlassCapsule>;
}

/** 桌機（md 以上）頁首的購物車圓鈕：視覺 36、熱區 44。App 內不顯示 */
function CartCircle({ count }: { count: number }) {
  return (
    <Link to="/cart" aria-label={`購物車，${count} 件`} className="group -mb-px -mr-1 hidden size-11 shrink-0 items-center justify-center md:flex">
      <span className="relative flex size-9 items-center justify-center rounded-full bg-canvas text-brand transition-colors duration-200 group-active:bg-press group-active:duration-0">
        <ShoppingCart size={20} strokeWidth={1.7} aria-hidden="true" />
        <CountBadge count={count} className="-right-1.5 -top-[3px]" />
      </span>
    </Link>
  );
}

const NAV_ICON_BTN = `${PRESS_FADE} relative flex size-11 items-center justify-center text-brand`;

function CartNavLink({ count }: { count: number }) {
  return (
    <Link to="/cart" aria-label={`購物車，${count} 件`} className={NAV_ICON_BTN}>
      <ShoppingCart size={22} strokeWidth={1.7} aria-hidden="true" />
      <CountBadge count={count} className="right-1 top-1.5" />
    </Link>
  );
}

/**
 * 分享商品頁／店家頁（D-7b）。App 內走系統分享面板（原生外掛只在 App 內動態載入）；
 * 網頁版用 Web Share API，沒有（多數桌機瀏覽器）就複製網址。
 */
function ShareButton({ target }: { target: ShareTarget }) {
  const { products, getShop } = useStore();
  const toast = useToast();
  const title = (target.kind === 'product' ? products.find(p => p.id === target.id)?.title : getShop(target.id)?.name) ?? '好物集';
  const route = `/${target.kind}/${target.id}`;

  const share = async () => {
    // App 內的 location 是 capacitor://…，分享出去別人打不開，改用正式站網址；網頁版自己就在正式站
    const url = isNative() ? publicUrl(route) : window.location.href;
    if (isNative()) {
      const r = await (await import('../../lib/native/share')).nativeShare({ title, url });
      // 系統面板失敗（對方 App 的分享延伸出錯等）：WebView 裡的 navigator.clipboard 不可用，不走下面的複製退路
      if (r === 'unavailable') toast('分享失敗，請再試一次', 'error');
      return;
    }
    if (typeof navigator.share === 'function') {
      try {
        await navigator.share({ title, url });
        return;
      } catch (e) {
        if (e instanceof DOMException && e.name === 'AbortError') return; // 使用者自己關掉面板
        // 其他原因（例如被政策擋）退回複製網址
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      toast('已複製連結', 'info');
    } catch {
      toast('無法複製連結，請從網址列複製', 'error');
    }
  };

  return (
    <button type="button" onClick={() => void share()} aria-label="分享" className={NAV_ICON_BTN}>
      <Share size={22} strokeWidth={1.7} aria-hidden="true" />
    </button>
  );
}

/** 桌機（md 以上）沒有 tab bar，常用入口放在頁首右側。手機不顯示 */
function DesktopLinks({ className = '' }: { className?: string }) {
  const { user } = useStore();
  const { openLogin } = useAuth();
  return (
    <div className={`hidden items-center gap-5 text-subhead text-muted md:flex ${className}`}>
      <Link to="/seller" className="hover:text-brand">賣家中心</Link>
      <Link to="/orders" className="hover:text-brand">我的訂單</Link>
      {user ? (
        <Link to="/account" className="hover:text-brand">我的帳號</Link>
      ) : (
        <button type="button" onClick={() => openLogin()} className="hover:text-brand">登入</button>
      )}
    </div>
  );
}

const SEARCH_BOX = 'flex h-9 items-center gap-1.5 rounded-[10px] bg-search px-2 text-body';

/** 首頁的搜尋框：長得像輸入框的連結，點了到 /search 並聚焦（那邊的 SearchForm 讀 focus=1） */
function SearchLink() {
  return (
    <Link to="/search?focus=1" aria-label="搜尋商品、店家" className="group mx-5 mt-1.5 block py-1">
      <span className={`${SEARCH_BOX} text-muted transition-colors duration-200 group-active:bg-press group-active:duration-0`}>
        <SearchIcon size={18} strokeWidth={1.7} aria-hidden="true" />
        商品、店家
      </span>
    </Link>
  );
}

function SearchForm({ q, setQ, onSubmit }: { q: string; setQ: (v: string) => void; onSubmit: (e: React.FormEvent) => void }) {
  const [params, setParams] = useSearchParams();
  const inputRef = useRef<HTMLInputElement>(null);
  const wantFocus = params.get('focus') === '1';

  // 從首頁搜尋框點進來：聚焦輸入框，並把 focus 參數拿掉（replace，返回鍵不會再聚焦一次）
  useLayoutEffect(() => {
    if (!wantFocus) return;
    inputRef.current?.focus();
    const next = new URLSearchParams(params);
    next.delete('focus');
    setParams(next, { replace: true });
  }, [wantFocus, params, setParams]);

  return (
    <form
      role="search"
      onSubmit={e => { onSubmit(e); inputRef.current?.blur(); }}
      className={`${SEARCH_BOX} mx-5 mt-2.5 text-ink pointer-fine:has-[:focus-visible]:outline-2 pointer-fine:has-[:focus-visible]:outline-offset-2 pointer-fine:has-[:focus-visible]:outline-brand`}
    >
      <SearchIcon size={18} strokeWidth={1.7} className="shrink-0 text-muted" aria-hidden="true" />
      <input
        ref={inputRef}
        type="search"
        enterKeyHint="search"
        value={q}
        onChange={e => setQ(e.target.value)}
        placeholder="商品、店家"
        aria-label="搜尋商品、店家"
        className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-muted"
      />
    </form>
  );
}

/** 首次載入：靜態灰塊（不閃爍）。搜尋框已經在頁首，所以首頁形狀不重複 */
function LoadingSkeleton({ kind }: { kind: 'home' | 'product' }) {
  return kind === 'product' ? <ProductSkeleton /> : <HomeSkeleton />;
}

function HomeSkeleton() {
  return (
    <div role="status" className="mx-auto max-w-6xl px-5 pt-3">
      <span className="sr-only">載入中</span>
      <div aria-hidden="true">
        <div className="flex gap-2 overflow-hidden">
          {[0, 1, 2, 3, 4].map(i => <div key={i} className="h-9 w-24 shrink-0 rounded-full bg-canvas" />)}
        </div>
        <div className="mt-4 aspect-[4/3] rounded-story bg-canvas md:aspect-[16/5]" />
        <div className="mt-4 h-4 w-2/3 rounded-md bg-canvas" />
        <div className="mt-2 h-4 w-1/3 rounded-md bg-canvas" />
      </div>
    </div>
  );
}

/** 商品頁骨架（§3.4）：主圖灰塊＋標題 2 條灰條，購買列先出現但停用。尺寸同 ProductDetail 的第一張照片與購買列，載入完不跳版 */
function ProductSkeleton() {
  return (
    // 高度＝視窗扣掉安全區條與 44 的導覽列，購買列才會貼在底部（手機沒有 tab bar）
    <div className="mx-auto flex min-h-[calc(100dvh-env(safe-area-inset-top)-44px)] max-w-6xl flex-col md:block md:min-h-0 md:px-4 md:pt-4">
      <div role="status" className="grid grid-cols-[minmax(0,1fr)] md:grid-cols-[450px_1fr] md:gap-8">
        <span className="sr-only">載入中</span>
        <div aria-hidden="true" className="px-5 pt-1 md:px-0 md:pt-0">
          <div className="aspect-square w-75 max-w-full rounded-story bg-canvas md:w-full" />
        </div>
        <div aria-hidden="true" className="px-5 pt-4 md:px-0 md:pt-0">
          <div className="h-5 w-4/5 rounded-md bg-canvas" />
          <div className="mt-2 h-5 w-1/2 rounded-md bg-canvas" />
        </div>
      </div>
      {/* 與 ProductDetail 的手機購買列同一組 class；按鈕停用，點了沒有反應 */}
      <div className="material sticky bottom-0 z-40 mt-auto grid grid-cols-[repeat(auto-fit,minmax(--spacing(32),1fr))] gap-3 border-t-[0.5px] border-separator pt-2 pr-[max(--spacing(5),env(safe-area-inset-right))] pb-[calc(--spacing(2)+env(safe-area-inset-bottom))] pl-[max(--spacing(5),env(safe-area-inset-left))] md:hidden">
        {['加入購物車', '直接購買'].map(label => (
          <button key={label} type="button" aria-disabled="true" className="inline-flex h-12.5 items-center justify-center rounded-full bg-canvas px-4 text-headline font-semibold text-muted-2">
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}

/** 買家 5 格分頁（順序與第 5 格「我的」沿用 UI 改版 D4）。onReselect：在首頁再點一次捲回頂端 */
function buyerTabs(atHome: boolean): TabItem[] {
  const line = { size: 24, strokeWidth: 1.7 } as const;
  const bold = { size: 24, strokeWidth: 2.5 } as const;
  return [
    { to: '/', label: '首頁', end: true, onReselect: atHome ? scrollPageToTop : undefined, icon: <House {...line} />, iconActive: <HouseFilled /> },
    { to: '/search', label: '逛逛', icon: <SearchIcon {...line} />, iconActive: <SearchIcon {...bold} /> },
    { to: '/orders', label: '訂單', icon: <ClipboardList {...line} />, iconActive: <ClipboardList {...bold} /> },
    { to: '/seller', label: '我要賣', icon: <Store {...line} />, iconActive: <Store {...line} /> },
    // 第 5 格一律是前往 /account 的分頁，未登入時登入入口在頁內（HIG：tab bar 用來導覽，不是放動作）
    { to: '/account', label: '我的', icon: <CircleUserRound {...line} />, iconActive: <ProfileFilled /> },
  ];
}

// 實心版：lucide 沒有 fill 版，直接填色會把內部細節（門、人像）也塗成同色而消失，所以內部細節改白色。
// 幾何與 lucide 的 House、CircleUserRound 相同，切換選中時不會跳動
function HouseFilled() {
  return (
    <svg width={24} height={24} viewBox="0 0 24 24" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="fill-current stroke-current">
      <path d="M3 10a2 2 0 0 1 .709-1.528l7-6a2 2 0 0 1 2.582 0l7 6A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      <path d="M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8" className="fill-white stroke-white" />
    </svg>
  );
}

function ProfileFilled() {
  return (
    <svg width={24} height={24} viewBox="0 0 24 24" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="fill-current stroke-current">
      <circle cx="12" cy="12" r="10" />
      <circle cx="12" cy="11" r="4" className="fill-white stroke-white" />
      <path d="M17.925 20.056a6 6 0 0 0-11.851.001" className="fill-white stroke-white" />
    </svg>
  );
}
