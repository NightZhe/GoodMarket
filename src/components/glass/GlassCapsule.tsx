import type { ReactNode } from 'react';
import { usePosture } from '../../lib/layout/posture';
import { TabCell, useTabLabels, type TabItem } from './tabs';

/**
 * 直立軌分頁組的層級（design-spec §3.2.3）：L0＝圖示＋標籤（56×50），L1＝純圖示（56×44）。
 * L2（收成一顆「目前分頁」鈕）與依可用高度自動選層級由 T5 加進來；這裡只提供外部指定，以及標籤放不下時自動降到 L1。
 */
export type RailLevel = 'L0' | 'L1';

type Common = {
  /** 這組膠囊的名稱（VoiceOver 唸）：工具組「頁面工具」、分頁組「主要分頁」「賣家中心分頁」 */
  label: string;
};

type Props = Common & (
  /** 工具組（上方）：children 放 GlassButton，由上而下。順序由呼叫端決定（C1：返回 → 購物車 → 分享；賣家：回到買家首頁） */
  | { children: ReactNode; tabs?: never; level?: never }
  /** 分頁組（下方）：5 格 */
  | { tabs: TabItem[]; level?: RailLevel; children?: never }
);

/** 標籤可用寬度＝軌 56 扣左右各 4（§7.3） */
const LABEL_ROOM = 48;

/**
 * 側邊姿態的直立玻璃軌（design-spec §3.2）。一條軌＝兩個獨立膠囊：工具組（貼 --rail-top）與分頁組（貼下），
 * 中間的空白是畫面本身。兩者各自掛在 DOM 該在的位置（工具組在頁首、分頁組在最後），VoiceOver 順序不因姿態改變。
 * 軌在系統欄同一側（data-bars 決定左右）。只在側邊姿態出現；bottom 姿態自己回傳 null（改由 TabPill／各頁自己的位置負責）。
 * 工具組是 role="group"，分頁組是 <nav>。
 */
export function GlassCapsule(props: Props) {
  return usePosture() === 'bottom' ? null : props.tabs
    ? <TabsBody label={props.label} tabs={props.tabs} level={props.level} />
    : <div role="group" aria-label={props.label} className="glass glass-capsule glass-capsule--tools">{props.children}</div>;
}

function TabsBody({ label, tabs, level = 'L0' }: { label: string; tabs: TabItem[]; level?: RailLevel }) {
  const { ref, fit } = useTabLabels(LABEL_ROOM);
  const labeled = level === 'L0' && fit;
  return (
    <nav ref={ref} aria-label={label} className="glass glass-capsule glass-capsule--tabs">
      {tabs.map(item => <TabCell key={item.to} item={item} kind="rail" labeled={labeled} compact={!labeled} />)}
    </nav>
  );
}
