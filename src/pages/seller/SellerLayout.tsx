import type { ComponentType } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { ChevronLeft, ClipboardList, LayoutDashboard, Package, PlusCircle, Star, Truck } from 'lucide-react';
import ChatIcon from '../../components/chat/ChatIcon';
import { useStore } from '../../store/StoreContext';
import { useChat } from '../../store/ChatContext';
import { CancelSummaryProvider, pendingCount, useCancelSummary } from '../../store/CancelSummaryContext';
import { badgeCount, chatNavLabel, formatUnread } from '../../lib/chat/unread';
import { SELLER_CHAT_LIST_PATH } from '../../lib/chat/sellerPaths';
import { useSplitLayout } from '../../lib/layout/splitLayout';
import { usePosture } from '../../lib/layout/posture';
import { SELLER_LAYOUT_MARK } from '../../lib/native/shellInset';
import { GlassButton, GlassCapsule, TabPill } from '../../components/glass';
import { SUB_HEADER_LAYOUT, hasOwnBackHeader, hasSaveTray, hidesNav, isChatThreadPath, showsHomeButton } from './sellerNav';
import { buildSellerTabs } from './sellerTabs';
import SellerTopBar from './SellerTopBar';

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
];

export default function SellerLayout() {
  return (
    <CancelSummaryProvider>
      <SellerLayoutView />
    </CancelSummaryProvider>
  );
}

function SellerLayoutView() {
  const { shopOrders } = useStore();
  const pending = pendingCount(useCancelSummary().summary);
  const navigate = useNavigate();
  const { pathname } = useLocation();
  // 匯入精靈是「我的商品」底下的流程，桌機側欄要高亮「我的商品」（App 內與手機的分頁選中另由 sellerTabRoutes 處理）
  const isOn = (to: string, isActive: boolean) =>
    isActive || (to === '/seller/products' && pathname.startsWith('/seller/products/import'));
  const hideNav = hidesNav(pathname);
  const toShip = shopOrders.filter(o => o.status === 'to_ship').length;
  const chatBadge = badgeCount(useChat().summary, 'shop');
  const split = useSplitLayout();
  // 聊聊對話頁在手機上整頁都是對話：自己有導覽列與輸入列，賣家頂欄跟它重複、鍵盤開著時還吃高度，所以藏起來（桌機雙欄照常有頂欄）
  const chatThreadFull = isChatThreadPath(pathname) && !split;

  // 水平姿態＝置中懸浮膠囊，側邊姿態（外蓋、展開橫向、書本）＝右（左）側直立軌，兩個元件自己看姿態、同一時間只出現一個（AC-21）。
  // 桌機網頁（md 以上）仍是左側欄；App 內 md: 不生效，永遠不出現左側欄（D4、X1）
  // 頂部：色帶（只蓋安全區）＋懸浮控制列（SellerTopBar）。有 SubHeader 的三頁（U-8 方案 A）色帶加高到安全區＋52、改灰，右群組坐在這一列，SubHeader 緊接其下
  const posture = usePosture();
  const ownBack = hasOwnBackHeader(pathname);
  const bandTall = SUB_HEADER_LAYOUT === 'band' && ownBack;
  const tabs = buildSellerTabs({ pathname, toShip, pending, chatBadge, goTo: navigate });

  return (
    <div {...{ [SELLER_LAYOUT_MARK]: '' }} className={`min-h-dvh bg-[#f6f6f6] ${bandTall ? '[--seller-band-h:calc(env(safe-area-inset-top)+52px)] md:[--seller-band-h:env(safe-area-inset-top)]' : '[--seller-band-h:env(safe-area-inset-top)]'}`}>
      {/* 上緣安全區材質色帶（與買家端同款）：蓋住狀態列／動態島，內容捲上來從底下穿過。桌機高度 0。
          --seller-band-h 是色帶高度，SubHeader 的黏頂位置也讀它（index.css 的 [data-seller-layout] 規則） */}
      <div aria-hidden="true" className={`${bandTall ? 'material-grouped' : 'material'} sticky top-0 z-40 h-(--seller-band-h)`} />
      {/* 聊聊對話頁在手機上整頁都是對話：自己有導覽列與輸入列，懸浮控制列藏起來（鍵盤開著時不吃高度），只留上面的色帶；桌機雙欄照常有 */}
      {!chatThreadFull && <SellerTopBar showHome={showsHomeButton(pathname, posture)} forceCollapse={SUB_HEADER_LAYOUT === 'collapse' && ownBack} />}

      {/* 側邊姿態的頁面工具：只有「回到買家首頁」一顆（X5），DOM 放在頁首之後、內容之前（朗讀順序）。物流表單頁整條軌都不出現（AC-25） */}
      {!hideNav && (
        <GlassCapsule label="頁面工具">
          <GlassButton to="/" label="回到買家首頁" icon={<ChevronLeft size={24} strokeWidth={2.4} />} />
        </GlassCapsule>
      )}

      <div className="app-shell flex">
        <aside className="sticky top-0 hidden h-dvh w-56 shrink-0 border-r border-line bg-white p-3 pt-15 md:block">
          {NAV.map(n => (
            <NavLink key={n.to} to={n.to} end={n.end} aria-label={n.to === SELLER_CHAT_LIST_PATH ? chatNavLabel(chatBadge) : undefined}
              className={({ isActive }) => `mb-1 flex ${n.to === '/seller/orders' && pending > 0 ? 'flex-wrap ' : ''}items-center gap-2.5 rounded-md px-3 py-2.5 text-sm transition ${isOn(n.to, isActive) ? 'bg-brand-soft font-medium text-brand' : 'hover:bg-canvas'}`}>
              <n.icon size={18} />
              {n.label}
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
        </aside>

        {/* 底部預留：有分頁導覽的頁＝膠囊高＋底距（側邊姿態只留系統底緣）；新增／編輯商品頁由 ProductForm 自己依托盤預留；物流表單頁不顯示導覽 */}
        <main className={`min-w-0 flex-1 ${chatThreadFull ? 'p-0' : `px-3 md:px-6 ${bandTall ? 'pt-0 md:pt-15' : 'pt-15'} ${hideNav || hasSaveTray(pathname) ? 'pb-6' : 'pb-[max(var(--tabs-clearance),1.5rem)] md:pb-6'}`}`}>
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
