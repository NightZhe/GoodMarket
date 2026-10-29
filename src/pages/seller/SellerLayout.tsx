import type { ComponentType } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { ChevronLeft, ClipboardList, ExternalLink, Landmark, LayoutDashboard, LogOut, Package, PlusCircle, Star, Truck } from 'lucide-react';
import ChatIcon from '../../components/chat/ChatIcon';
import { useStore } from '../../store/StoreContext';
import { useChat } from '../../store/ChatContext';
import { CancelSummaryProvider, pendingCount, useCancelSummary } from '../../store/CancelSummaryContext';
import { usePayoutState } from '../../lib/payment/useBankAccounts';
import { usePaymentConfig } from '../../lib/payment/usePaymentConfig';
import PayoutBadge from '../../components/payment/PayoutBadge';
import { badgeCount, chatNavLabel, formatUnread } from '../../lib/chat/unread';
import { SELLER_CHAT_LIST_PATH } from '../../lib/chat/sellerPaths';
import { useSplitLayout } from '../../lib/layout/splitLayout';
import { GlassButton, GlassCapsule, TabPill } from '../../components/glass';
import { hasSaveTray, hidesNav, isChatThreadPath } from './sellerNav';
import { buildSellerTabs } from './sellerTabs';

const NAV: { to: string; label: string; icon: ComponentType<{ size?: number }>; end: boolean }[] = [
  { to: '/seller', label: '賣場總覽', icon: LayoutDashboard, end: true },
  // 聊聊的對話頁是 /seller/chat 底下的子路由，側欄要保持選中（end: false）
  { to: SELLER_CHAT_LIST_PATH, label: '聊聊', icon: ChatIcon, end: false },
  { to: '/seller/products', label: '我的商品', icon: Package, end: true },
  { to: '/seller/products/new', label: '新增商品', icon: PlusCircle, end: true },
  { to: '/seller/orders', label: '訂單管理', icon: ClipboardList, end: true },
  { to: '/seller/reviews', label: '評價管理', icon: Star, end: true },
  // 物流設定的新增／編輯表單是 /seller/logistics 底下的子路由，側欄要保持選中（end: false）
  { to: '/seller/logistics', label: '物流設定', icon: Truck, end: false },
  // 銀行帳號只在線上付款開關打開時出現；新增流程是 /seller/payout 底下的子路由（end: false）
  { to: '/seller/payout', label: '銀行帳號', icon: Landmark, end: false },
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
  // 匯入精靈是「我的商品」底下的流程，桌機側欄要高亮「我的商品」（App 內與手機的分頁選中另由 sellerTabRoutes 處理）
  const isOn = (to: string, isActive: boolean) =>
    isActive || (to === '/seller/products' && pathname.startsWith('/seller/products/import'));
  const hideNav = hidesNav(pathname);
  const { enabled: payEnabled } = usePaymentConfig();
  const payoutState = usePayoutState(payEnabled);
  const shop = myShop!; // SellerGate 已確保登入且有店
  const toShip = shopOrders.filter(o => o.status === 'to_ship').length;
  const chatBadge = badgeCount(useChat().summary, 'shop');
  const split = useSplitLayout();
  // 聊聊對話頁在手機上整頁都是對話：自己有導覽列與輸入列，賣家頂欄跟它重複、鍵盤開著時還吃高度，所以藏起來（桌機雙欄照常有頂欄）
  const chatThreadFull = isChatThreadPath(pathname) && !split;

  // 水平姿態＝置中懸浮膠囊，側邊姿態（外蓋、展開橫向、書本）＝右（左）側直立軌，兩個元件自己看姿態、同一時間只出現一個（AC-21）。
  // 桌機網頁（md 以上）仍是左側欄；App 內 md: 不生效，永遠不出現左側欄（D4、X1）
  const tabs = buildSellerTabs({ pathname, toShip, pending, chatBadge, goTo: navigate });

  return (
    <div className="min-h-dvh bg-[#f6f6f6]">
      {/* 頂欄：背景全寬（畫進安全區與軌欄），logo、店名、登出留在內容欄——四邊各自吃安全區，右端讓開直立軌（design-spec §5.4.1）。
          高度＝內容 56＋上緣安全區（取代 native.css 對 header.h-14 的補丁） */}
      {chatThreadFull ? (
        // 頂欄藏起來之後，狀態列／動態島仍要有一條材質蓋住（對話頁自己的導覽列在它下面）
        <div aria-hidden="true" className="material sticky top-0 z-40 h-[env(safe-area-inset-top)]" />
      ) : (
        <header className="sticky top-0 z-40 flex h-[calc(3.5rem+env(safe-area-inset-top))] items-center gap-3 border-b border-line bg-white pl-[calc(var(--inset-l)+1rem)] pr-[calc(var(--inset-r)+1rem)] pt-[env(safe-area-inset-top)] md:px-6">
          <Link to="/seller" className="flex min-h-11 items-center gap-1.5 font-bold text-brand">
            🛍️ <span>好物集</span><span className="font-normal text-ink">賣家中心</span>
          </Link>
          <div className="ml-auto flex min-w-0 items-center gap-2 md:gap-4">
            <Link to={`/shop/${shop.id}`} className="hidden items-center gap-1 text-sm text-muted hover:text-brand md:flex">
              查看我的賣場 <ExternalLink size={14} />
            </Link>
            <span className="flex min-w-0 items-center gap-2 rounded-full bg-canvas py-1 pl-1 pr-3 text-sm">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white text-lg">{shop.avatar}</span>
              <span className="max-w-28 truncate md:max-w-none">{shop.name}</span>
            </span>
            <button onClick={() => { void signOut(); navigate('/seller'); }} aria-label="登出" title="登出" className="-mr-2 flex size-11 shrink-0 items-center justify-center text-muted hover:text-brand md:mr-0 md:size-auto md:p-2">
              <LogOut size={18} aria-hidden="true" />
            </button>
          </div>
        </header>
      )}

      {/* 側邊姿態的頁面工具：只有「回到買家首頁」一顆（X5），DOM 放在頁首之後、內容之前（朗讀順序）。物流表單頁整條軌都不出現（AC-25） */}
      {!hideNav && (
        <GlassCapsule label="頁面工具">
          <GlassButton to="/" label="回到買家首頁" icon={<ChevronLeft size={24} strokeWidth={2.4} />} />
        </GlassCapsule>
      )}

      <div className="app-shell flex">
        <aside className="sticky top-14 hidden h-[calc(100dvh-3.5rem)] w-56 shrink-0 border-r border-line bg-white p-3 md:block">
          {NAV.filter(n => n.to !== '/seller/payout' || payEnabled).map(n => (
            <NavLink key={n.to} to={n.to} end={n.end} aria-label={n.to === SELLER_CHAT_LIST_PATH ? chatNavLabel(chatBadge) : undefined}
              className={({ isActive }) => `mb-1 flex ${n.to === '/seller/orders' && pending > 0 ? 'flex-wrap ' : ''}items-center gap-2.5 rounded-md px-3 py-2.5 text-sm transition ${isOn(n.to, isActive) ? 'bg-brand-soft font-medium text-brand' : 'hover:bg-canvas'}`}>
              <n.icon size={18} />
              {n.label}
              {n.to === '/seller/payout' && payoutState && <PayoutBadge state={payoutState} className="ml-auto" />}
              {n.to === SELLER_CHAT_LIST_PATH && chatBadge > 0 && (
                <span aria-hidden="true" className="ml-auto rounded-full bg-brand px-1.5 text-xs leading-5 text-white">{formatUnread(chatBadge)}</span>
              )}
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

        {/* 底部預留：有分頁導覽的頁＝膠囊高＋底距（側邊姿態只留系統底緣）；新增／編輯商品頁由 ProductForm 自己依托盤預留；物流表單頁不顯示導覽 */}
        <main className={`min-w-0 flex-1 ${chatThreadFull ? 'p-0' : `p-3 md:p-6 ${hideNav || hasSaveTray(pathname) ? 'pb-6' : 'pb-[max(var(--tabs-clearance),1.5rem)] md:pb-6'}`}`}>
          <Outlet />
        </main>
      </div>

      {!hideNav && (
        <>
          <TabPill items={tabs} label="賣家中心分頁" className="md:hidden" />
          <GlassCapsule label="賣家中心分頁" tabs={tabs} />
        </>
      )}
    </div>
  );
}
