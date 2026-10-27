import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { CountBadge } from './CountBadge';

type Props = {
  /** 朗讀名稱，也是唯一的文字：圖示鈕沒有可見文字。購物車請把件數寫進來（「購物車，2 件」） */
  label: string;
  /** 圖示（lucide 22pt、線寬 1.7；返回用 24pt、線寬 2.4）。aria-hidden 由元件包，不必自己加 */
  icon: ReactNode;
  /** 右上角數字徽章；0 或沒給＝不顯示 */
  badge?: number;
  /** 定位用 class。單顆懸浮時由呼叫端決定位置（例如首頁購物車 fixed 在右上）；放進 GlassCapsule 時不必給 */
  className?: string;
} & ({ to: string; onClick?: never } | { onClick: () => void; to?: never });

/**
 * 懸浮玻璃鈕（design-spec §4.2）：44×44 圓，熱區等於視覺。
 * 單獨使用時是浮在內容上的玻璃圓；放進 GlassCapsule 時自動變成軌裡的平面項目（沒有自己的底，按下是灰圓）。
 */
export function GlassButton({ label, icon, badge = 0, className = '', to, onClick }: Props) {
  const cls = `glass glass-btn z-40 flex size-11 shrink-0 items-center justify-center rounded-full text-brand ${className}`;
  const body = (
    <>
      <span aria-hidden="true" className="flex">{icon}</span>
      <CountBadge count={badge} className="-right-[3px] -top-[3px] in-[.glass-capsule]:-right-px in-[.glass-capsule]:top-px" />
    </>
  );
  return to !== undefined
    ? <Link to={to} aria-label={label} className={cls}>{body}</Link>
    : <button type="button" onClick={onClick} aria-label={label} className={cls}>{body}</button>;
}
