import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ChevronLeft, CircleUserRound, LogOut, Store, Truck } from 'lucide-react';
import { GlassGroup, useElementWidth, type GlassGroupHandle, type GlassGroupItem } from '../../components/glass';
import { useToast } from '../../components/Toast';
import { useStore } from '../../store/StoreContext';
import { HOME_BUTTON_CHROME, homeButtonCompact } from './sellerNav';
import SignOutSheet from './SignOutSheet';
import { performSignOut } from './signOutFlow';

/**
 * 賣家中心頂部的懸浮控制列（取代原本的白色頂欄）：左「‹ 首頁」（回買家首頁）、右一組四顆圖示的玻璃膠囊（我的賣場、物流設定、我的帳戶 ｜ 登出）。
 * 材質、陰影、位置與買家首頁的購物車同一套：top＝安全區＋4、左右＝--inset＋16（側邊姿態的 --inset-r 已含直立軌欄寬）。
 * 整列是有名稱的 <nav>，DOM 放在內容之前（朗讀順序：左鈕 → 右群組 → 頁面 h1）。列本身不吃點擊（透明處讓下面的內容照常捲動、點擊）。
 * 登出：點圖示 → 確認面板（SignOutSheet）→ 只登出這台（signOutBuyer，scope:'local'）→ 到 /seller。
 */
export default function SellerTopBar({ showHome, forceCollapse = false }: { showHome: boolean; forceCollapse?: boolean }) {
  const { myShop, signOutBuyer } = useStore();
  const navigate = useNavigate();
  const toast = useToast();
  const rowRef = useRef<HTMLElement>(null);
  const rowWidth = useElementWidth(rowRef);
  const groupRef = useRef<GlassGroupHandle>(null);
  const [confirming, setConfirming] = useState(false);

  const shop = myShop!; // SellerGate 已確保登入且有店
  const items: GlassGroupItem[] = [
    { key: 'shop', label: '我的賣場', icon: <Store size={22} strokeWidth={1.7} />, to: `/shop/${shop.id}` },
    { key: 'logistics', label: '物流設定', icon: <Truck size={22} strokeWidth={1.7} />, to: '/seller/logistics' },
    { key: 'account', label: '我的帳戶', icon: <CircleUserRound size={22} strokeWidth={1.7} />, to: '/account' },
    { key: 'signout', label: '登出', icon: <LogOut size={22} strokeWidth={1.7} />, onClick: () => setConfirming(true), hasPopup: 'dialog', separatorBefore: true },
  ];

  return (
    <>
      <nav
        ref={rowRef} aria-label="賣家中心工具"
        className="pointer-events-none fixed top-[calc(env(safe-area-inset-top)+4px)] left-[calc(var(--inset-l)+16px)] right-[calc(var(--inset-r)+16px)] z-[41] flex h-11 items-center gap-2"
      >
        {showHome && <HomeButton rowWidth={rowWidth} onLostFocus={() => groupRef.current?.focusFirst()} />}
        <GlassGroup label="賣家中心功能" items={items} forceCollapse={forceCollapse} handleRef={groupRef} />
      </nav>
      {confirming && (
        <SignOutSheet
          onConfirm={() => performSignOut({ signOut: signOutBuyer, navigate, toast })}
          onClose={() => setConfirming(false)}
          restoreFocus={() => groupRef.current?.focusItem('signout')}
        />
      )}
    </>
  );
}

/**
 * 左上「‹ 首頁」：可見字「首頁」，朗讀「回到買家首頁」（含可見字，WCAG 2.5.3；說清楚是買家端，賣家中心裡的「首頁」會被聽成賣場總覽）。
 * 字色 brand-dark（對玻璃最差合成色 4.79，brand 只有 3.73）。連「⋯」都放不下時縮成只有「‹」的 44 圓鈕（字留在 DOM 量寬，朗讀不變）。
 * 被拿掉（姿態切換）時若焦點在它身上，交給 onLostFocus 把焦點移到右群組。
 */
function HomeButton({ rowWidth, onLostFocus }: { rowWidth: number; onLostFocus: () => void }) {
  const ref = useRef<HTMLAnchorElement>(null);
  const textRef = useRef<HTMLSpanElement>(null);
  const textWidth = useElementWidth(textRef);
  const compact = Number.isFinite(textWidth) && homeButtonCompact(rowWidth, HOME_BUTTON_CHROME + textWidth);

  const lostFocus = useRef(onLostFocus);
  useEffect(() => { lostFocus.current = onLostFocus; });
  // layout effect 的清理在 DOM 移除之前執行，此時 activeElement 還是這顆鈕
  useLayoutEffect(() => () => { if (document.activeElement === ref.current) lostFocus.current(); }, []);

  return (
    <Link
      ref={ref} to="/" aria-label="回到買家首頁"
      className={`glass glass-btn pointer-events-auto z-40 flex h-11 shrink-0 items-center rounded-full text-brand-dark ${compact ? 'w-11 justify-center' : 'pl-1.5 pr-3.5'}`}
    >
      <ChevronLeft size={24} strokeWidth={2.4} aria-hidden="true" className="shrink-0" />
      <span ref={textRef} aria-hidden="true" className={`whitespace-nowrap text-body ${compact ? 'pointer-events-none absolute opacity-0' : ''}`}>首頁</span>
    </Link>
  );
}
