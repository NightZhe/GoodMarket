import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { ClipboardList, ExternalLink, LayoutDashboard, LogOut, Package, PlusCircle, Star } from 'lucide-react';
import { useStore } from '../../store/StoreContext';
import { CancelSummaryProvider, pendingCount, useCancelSummary } from '../../store/CancelSummaryContext';
import { ordersNavLabel } from '../../lib/payment/refundView';

const NAV = [
  { to: '/seller', label: '賣場總覽', icon: LayoutDashboard, end: true },
  { to: '/seller/products', label: '我的商品', icon: Package, end: true },
  { to: '/seller/products/new', label: '新增商品', icon: PlusCircle, end: true },
  { to: '/seller/orders', label: '訂單管理', icon: ClipboardList, end: true },
  { to: '/seller/reviews', label: '評價管理', icon: Star, end: true },
];

export default function SellerLayout() {
  return (
    <CancelSummaryProvider>
      <SellerLayoutView />
    </CancelSummaryProvider>
  );
}

function SellerLayoutView() {
  const { myShop, signOut, shopOrders } = useStore();
  const pending = pendingCount(useCancelSummary().summary);
  const navigate = useNavigate();
  const { pathname } = useLocation();
  // 匯入精靈是「我的商品」底下的流程，側欄與分頁列都要高亮「我的商品」
  const isOn = (to: string, isActive: boolean) => isActive || (to === '/seller/products' && pathname.startsWith('/seller/products/import'));
  const shop = myShop!; // SellerGate 已確保登入且有店
  const toShip = shopOrders.filter(o => o.status === 'to_ship').length;

  return (
    <div className="min-h-dvh bg-[#f6f6f6]">
      <header className="sticky top-0 z-40 flex h-14 items-center gap-3 border-b border-line bg-white px-4 md:px-6">
        <Link to="/seller" className="flex items-center gap-1.5 font-bold text-brand">
          🛍️ <span>好物集</span><span className="font-normal text-ink">賣家中心</span>
        </Link>
        <div className="ml-auto flex items-center gap-2 md:gap-4">
          <Link to={`/shop/${shop.id}`} className="hidden items-center gap-1 text-sm text-muted hover:text-brand md:flex">
            查看我的賣場 <ExternalLink size={14} />
          </Link>
          <span className="flex items-center gap-2 rounded-full bg-canvas py-1 pl-1 pr-3 text-sm">
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-white text-lg">{shop.avatar}</span>
            <span className="max-w-28 truncate">{shop.name}</span>
          </span>
          <button onClick={() => { void signOut(); navigate('/seller'); }} aria-label="登出" title="登出" className="p-2 text-muted hover:text-brand">
            <LogOut size={18} />
          </button>
        </div>
      </header>

      <div className="flex">
        <aside className="sticky top-14 hidden h-[calc(100dvh-3.5rem)] w-56 shrink-0 border-r border-line bg-white p-3 md:block">
          {NAV.map(n => (
            <NavLink key={n.to} to={n.to} end={n.end}
              className={({ isActive }) => `mb-1 flex ${n.to === '/seller/orders' && pending > 0 ? 'flex-wrap ' : ''}items-center gap-2.5 rounded-md px-3 py-2.5 text-sm transition ${isOn(n.to, isActive) ? 'bg-brand-soft font-medium text-brand' : 'hover:bg-canvas'}`}>
              <n.icon size={18} />
              {n.label}
              {n.to === '/seller/orders' && toShip > 0 && (
                <span className="ml-auto rounded-full bg-brand px-1.5 text-xs leading-5 text-white">{toShip}</span>
              )}
              {n.to === '/seller/orders' && pending > 0 && (
                <span className="basis-full pl-[1.625rem]">
                  <span className="inline-flex items-center rounded-full border border-warning-border bg-warning-bg px-2 text-xs font-medium leading-5 text-warning-text">取消申請 {pending}</span>
                </span>
              )}
            </NavLink>
          ))}
          <Link to="/" className="mt-6 block border-t border-line px-3 pt-4 text-xs text-muted hover:text-brand">← 回到買家首頁</Link>
        </aside>

        <main className="min-w-0 flex-1 p-3 pb-28 md:p-6">
          <Outlet />
        </main>
      </div>

      <nav className="pb-safe fixed inset-x-0 bottom-0 z-40 grid grid-cols-5 border-t border-line bg-white md:hidden">
        {NAV.map(n => (
          <NavLink key={n.to} to={n.to} end={n.end}
            aria-label={n.to === '/seller/orders' ? ordersNavLabel(toShip, pending) : undefined}
            className={({ isActive }) => `relative flex min-h-14 flex-col items-center justify-center gap-0.5 px-1 py-2 text-center text-[11px] leading-tight ${isOn(n.to, isActive) ? 'text-brand' : 'text-muted'}`}>
            <n.icon size={22} />
            {n.label}
            {n.to === '/seller/orders' && pending > 0 && (
              <span aria-hidden="true" className="absolute left-[calc(50%-20px)] top-1.5 h-3 w-3 rounded-full border-2 border-warning-text bg-warning" />
            )}
            {n.to === '/seller/orders' && toShip > 0 && (
              <span className="absolute right-[calc(50%-20px)] top-1 rounded-full bg-brand px-1 text-[10px] leading-4 text-white">{toShip}</span>
            )}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
