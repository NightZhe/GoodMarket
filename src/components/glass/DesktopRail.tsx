import { TabCell, type TabItem } from './tabs';

type Props = {
  /** 六格（買家：首頁／逛逛／購物車／訂單／聊聊／我的，D6） */
  tabs: TabItem[];
  /** 導覽區域的名稱（讀屏唸）：「主要分頁」 */
  label: string;
  /** 顯示條件由呼叫端用斷點 class 控制（買家：`hidden md:flex`，md 只在非 App 生效） */
  className?: string;
};

/**
 * 桌機網頁（md 以上、非 App）右側的浮動導覽軌（合夥人回饋 10/31 工單 C、design-C.md）：
 * 貼右緣 16、垂直置中、fixed 不隨捲動；外殼 56 寬、格沿用直立軌的 48×50（圖示＋小字）。幾何在 index.css 的 .glass-desk-rail。
 * 與 Duo 的直立軌（GlassCapsule）刻意分開：那條的位置被 html[data-bars] 與 --rail-center 綁住，而且只在 App 內的側邊姿態出現。
 * 目前頁有淡橘底（同手機膠囊；brand 小字壓在玻璃上對比不夠，要有底才過），滑鼠 hover 非目前頁淡灰底。
 * 視窗高 < 432 時標籤改藏起來、格矮成 44（CSS 媒體查詢，不做 L2 浮層）。
 */
export function DesktopRail({ tabs, label, className = '' }: Props) {
  return (
    <nav aria-label={label} className={`glass glass-desk-rail ${className}`}>
      {tabs.map(item => <TabCell key={item.to} item={item} kind="desk" labeled />)}
    </nav>
  );
}
