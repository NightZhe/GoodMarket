import { usePosture } from '../../lib/layout/posture';
import { TabCell, useTabLabels, type TabItem } from './tabs';

type Props = {
  /** 5 格固定，不做 More（買家：首頁／逛逛／訂單／我要賣／我的；賣家：賣場總覽…評價管理） */
  items: TabItem[];
  /** 導覽區域的名稱（VoiceOver 唸）：「主要分頁」「賣家中心分頁」 */
  label: string;
  /** 強制圖示＋標籤（'labeled'）或純圖示（'iconOnly'）。不給＝標籤放得下就顯示，放不下（文字放大到 AX1 以上）自動純圖示（C4） */
  variant?: 'labeled' | 'iconOnly';
  /** 額外的 class。賣家與買家在桌機網頁（md 以上）沒有分頁導覽或另有側欄，傳 'md:hidden'；App 內 md: 本來就不生效 */
  className?: string;
};

/** 標籤可用寬度＝格子 60 扣左右各 2 */
const LABEL_ROOM = 56;

/**
 * 水平姿態的底部導航：置中的懸浮玻璃膠囊（design-spec §3.4.1，高 62、五格寬 312、離底 env＋8、至少 12）。
 * 只在 bottom 姿態出現；側邊姿態自己回傳 null（改由 GlassCapsule 的直立軌負責），呼叫端不必判斷姿態。
 * 內容底部要預留 `var(--tabs-clearance)`（內直 120）。z-40，在 sheet／modal 之下。
 */
export function TabPill(props: Props) {
  return usePosture() === 'bottom' ? <PillBody {...props} /> : null;
}

function PillBody({ items, label, variant, className = '' }: Props) {
  const { ref, fit } = useTabLabels(LABEL_ROOM);
  const labeled = variant ? variant === 'labeled' : fit;
  return (
    <nav ref={ref} aria-label={label} className={`glass glass-pill ${labeled ? '' : 'glass-pill--icons'} ${className}`}>
      {items.map(item => <TabCell key={item.to} item={item} kind="pill" labeled={labeled} />)}
    </nav>
  );
}
