import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { ClipboardList, Home, Loader2, LogIn, Search as SearchIcon, ShoppingCart, Store, UserRound } from 'lucide-react';
import { useStore } from '../../store/StoreContext';
import { useAuth } from '../../store/AuthContext';

export function Logo({ light = true }: { light?: boolean }) {
  return (
    <Link to="/" className={`flex shrink-0 items-center gap-1.5 ${light ? 'text-white' : 'text-brand'}`}>
      <span className="text-2xl leading-none md:text-3xl">🛍️</span>
      <span className="text-xl font-bold tracking-tight md:text-2xl">好物集</span>
    </Link>
  );
}

export default function BuyerLayout() {
  const { cartCount, loading, loadError, reload, user } = useStore();
  const { openLogin } = useAuth();
  // 只有第一次載入商品時用轉圈圈取代頁面。登入、登出、登入過期之後的重新載入是在背景進行：
  // 頁面若被卸載，結帳頁填到一半的收件資料就會消失（登入過期時要能留著，AC-13）
  const loadedOnce = useRef(false);
  if (!loading) loadedOnce.current = true;
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [params] = useSearchParams();
  const [q, setQ] = useState(params.get('q') ?? '');

  useEffect(() => setQ(params.get('q') ?? ''), [params]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    navigate(`/search?q=${encodeURIComponent(q.trim())}`);
  };

  // 商品頁、結帳頁在手機上有自己的底部操作列，不顯示全站導覽
  // 評價表單（/orders/:id/review）手機底部有自己的送出列，也不顯示全站導覽
  // 地址新增／編輯頁（/account/addresses/new、/account/addresses/:id）有鍵盤，固定的底部分頁在 iOS Safari 鍵盤開關時會跳
  const hideTabBar = pathname.startsWith('/product/') || pathname === '/checkout' || pathname === '/cart'
    || /^\/orders\/[^/]+\/review$/.test(pathname) || pathname.startsWith('/account/addresses/');

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-40 bg-gradient-to-b from-brand to-[#f46b35] text-white shadow-sm">
        <div className="mx-auto hidden max-w-6xl items-center justify-between px-4 pt-1.5 text-xs md:flex">
          <div className="flex gap-4 opacity-95">
            <Link to="/seller" className="hover:opacity-80">賣家中心</Link>
            <span className="opacity-50">|</span>
            <Link to="/seller" className="hover:opacity-80">免費開店上架</Link>
          </div>
          <div className="flex items-center gap-4">
            <Link to="/orders" className="hover:opacity-80">我的訂單</Link>
            <span className="opacity-50">|</span>
            {user ? (
              <Link to="/account" className="inline-flex items-center gap-1 font-medium hover:opacity-80">
                <UserRound size={12} aria-hidden="true" />我的帳號
              </Link>
            ) : (
              <button type="button" onClick={() => openLogin()} className="inline-flex items-center gap-1 font-medium hover:opacity-80">
                <LogIn size={12} aria-hidden="true" />登入
              </button>
            )}
          </div>
        </div>
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-3 py-2.5 md:gap-10 md:px-4 md:py-4">
          <Logo />
          <form onSubmit={submit} className="flex min-w-0 flex-1 items-center rounded-sm bg-white p-[3px]">
            <input
              value={q}
              onChange={e => setQ(e.target.value)}
              placeholder="搜尋商品、店家"
              aria-label="搜尋"
              className="min-w-0 flex-1 px-2.5 text-sm text-ink outline-none placeholder:text-muted"
            />
            <button type="submit" aria-label="搜尋" className="flex h-8 items-center rounded-sm bg-brand px-4 text-white transition hover:bg-brand-dark md:h-9 md:px-6">
              <SearchIcon size={18} />
            </button>
          </form>
          <Link to="/cart" aria-label={`購物車，${cartCount} 件`} className="relative shrink-0 p-1.5 transition hover:opacity-80">
            <ShoppingCart size={26} strokeWidth={1.8} />
            {cartCount > 0 && (
              <span className="absolute -right-1 -top-0.5 min-w-5 rounded-full border-2 border-brand bg-white px-1 text-center text-[11px] font-semibold leading-4 text-brand">
                {cartCount > 99 ? '99+' : cartCount}
              </span>
            )}
          </Link>
        </div>
      </header>

      <main className={`flex-1 ${hideTabBar ? '' : 'pb-20 md:pb-0'}`}>
        {loadError ? (
          <div className="mx-auto max-w-md px-4 py-24 text-center">
            <p className="text-5xl">📡</p>
            <p className="mt-4 font-medium">載入商品失敗</p>
            <p className="mt-1 text-sm text-muted">{loadError}</p>
            <button onClick={() => void reload()} className="mt-5 rounded-sm bg-brand px-6 py-2.5 text-sm text-white">重新載入</button>
          </div>
        ) : loading && !loadedOnce.current ? (
          <div className="flex items-center justify-center py-32 text-muted">
            <Loader2 size={28} className="animate-spin" />
          </div>
        ) : (
          <Outlet />
        )}
      </main>

      <footer className="mt-10 hidden border-t-4 border-brand bg-white md:block">
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

      {!hideTabBar && (
        <nav className="pb-safe fixed inset-x-0 bottom-0 z-40 grid grid-cols-5 border-t border-line bg-white/95 backdrop-blur md:hidden">
          <Tab to="/" icon={<Home size={22} />} label="首頁" end />
          <Tab to="/search" icon={<SearchIcon size={22} />} label="逛逛" />
          <Tab to="/orders" icon={<ClipboardList size={22} />} label="訂單" />
          <Tab to="/seller" icon={<Store size={22} />} label="我要賣" />
          {user ? (
            <Tab to="/account" icon={<UserRound size={22} />} label="我的" ariaLabel="我的帳號" />
          ) : (
            // 登入不是一個頁面，是開登入面板、登入完留在原頁：所以是按鈕，不會亮起
            <button type="button" onClick={() => openLogin()} className={TAB_CLASS('text-muted')}>
              <LogIn size={22} aria-hidden="true" />登入
            </button>
          )}
        </nav>
      )}
    </div>
  );
}

const TAB_CLASS = (tone: string) => `flex min-h-11 flex-col items-center gap-0.5 py-2 text-[11px] ${tone}`;

function Tab({ to, icon, label, end, ariaLabel }: { to: string; icon: React.ReactNode; label: string; end?: boolean; ariaLabel?: string }) {
  return (
    <NavLink
      to={to}
      end={end}
      aria-label={ariaLabel}
      className={({ isActive }) => TAB_CLASS(isActive ? 'text-brand' : 'text-muted')}
    >
      {icon}
      {label}
    </NavLink>
  );
}
