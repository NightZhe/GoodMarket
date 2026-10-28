import type { ReactNode } from 'react';
import { ClipboardList, LayoutDashboard, Package, PlusCircle, type LucideIcon } from 'lucide-react';
import ChatIcon from '../../components/chat/ChatIcon';
import type { TabItem } from '../../components/glass';
import { chatNavLabel } from '../../lib/chat/unread';
import { ordersNavLabel } from '../../lib/payment/refundView';
import { sellerTabRoutes, type SellerTabKey } from './sellerNav';

// 賣家底欄五格的內容（標籤、圖示、角標、朗讀名稱）。路由與選中邏輯在 sellerNav.ts；這裡把它變成共用元件吃的 TabItem。
// 抽出來是為了不渲染整個 SellerLayout（要一堆 context）就能測標籤與朗讀名稱。

/** 底欄標籤用短字（N2＝A，使用者定版）；桌機側欄保留全名，見 SellerLayout 的 NAV */
const TAB_LABEL: Record<SellerTabKey, string> = { overview: '總覽', chat: '聊聊', products: '商品', new: '新增', orders: '訂單' };

type IconFor = (strokeWidth: number, marked: boolean) => ReactNode;

const lucide = (Icon: LucideIcon): IconFor => (strokeWidth, marked) => <TabIcon marked={marked}><Icon size={24} strokeWidth={strokeWidth} /></TabIcon>;

const TAB_ICON: Record<SellerTabKey, IconFor> = {
  overview: lucide(LayoutDashboard),
  chat: (strokeWidth, marked) => <TabIcon marked={marked}><ChatIcon size={24} strokeWidth={strokeWidth} /></TabIcon>,
  products: lucide(Package),
  new: lucide(PlusCircle),
  orders: lucide(ClipboardList),
};

interface Args {
  pathname: string;
  /** 待出貨訂單數（訂單格角標） */
  toShip: number;
  /** 買家申請取消的筆數（訂單格圖示左上黃點、朗讀） */
  pending: number;
  /** 有未讀的店家側對話數（聊聊格角標，badgeCount(summary, 'shop')） */
  chatBadge: number;
  /** 代選中的分頁被再點一次時，導向它真正的目的地 */
  goTo: (to: string) => void;
}

export function buildSellerTabs({ pathname, toShip, pending, chatBadge, goTo }: Args): TabItem[] {
  return sellerTabRoutes(pathname).map(r => {
    const ordersTab = r.key === 'orders';
    const chatTab = r.key === 'chat';
    const marked = ordersTab && pending > 0;
    return {
      to: r.to,
      end: true, // 精確比對：代選中的分頁，to 已換成目前路徑（sellerNav.ts）
      label: TAB_LABEL[r.key],
      ariaLabel: ordersTab ? ordersNavLabel(toShip, pending) : chatTab ? chatNavLabel(chatBadge) : undefined,
      icon: TAB_ICON[r.key](1.7, marked),
      iconActive: TAB_ICON[r.key](2.5, marked),
      badge: ordersTab ? toShip : chatTab ? chatBadge : undefined,
      onReselect: r.to === r.goTo ? undefined : () => goTo(r.goTo),
    };
  });
}

/** 分頁圖示（24pt）。marked＝有取消申請：圖示左上掛黃點（沿用原底欄的標記），徽章（數字）在右上由分頁格自己畫 */
function TabIcon({ marked, children }: { marked: boolean; children: ReactNode }) {
  return (
    <span className="relative flex">
      {children}
      {marked && <span aria-hidden="true" className="absolute -left-1 -top-0.5 size-3 rounded-full border-2 border-warning-text bg-warning" />}
    </span>
  );
}
