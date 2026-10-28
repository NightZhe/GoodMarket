import { GlassTray, TrayButton } from '../../components/glass';
import { TRAY_DIMMED } from '../../lib/layout/trayPlacement';
import { useTrayHeightReport } from '../../lib/layout/trayReserve';

/** 兩欄時托盤放右欄：把「內容欄左緣」挪到折線右側的中線帶外緣，托盤自己置中在剩下的右半（D13、Q3） */
const RIGHT_COLUMN = '[--inset-l:calc(50vw+var(--midline-half))]';

type Props = {
  /** 商品頁目前是兩欄：托盤落在折線右側 */
  twoColumn: boolean;
  /** 庫存 0：原生 disabled，顯示「已售完」 */
  soldOut?: boolean;
  /** 自己的商品或離線：外觀停用但仍可聚焦，按下由 onClick 說明原因 */
  dimmed?: boolean;
  onCart?: () => void;
  onBuy?: () => void;
  /** 托盤實測高度（文字放大時兩顆按鈕上下排會變高）：頁面用 trayReserveStyle 把內容底部預留跟著加高。尺寸改變時會再報一次 */
  onHeight?: (height: number) => void;
};

/**
 * 商品頁購買托盤（D6、C5）：App 與手機網頁在任何寬度都固定在底部，桌機網頁（md 以上）改用右欄內的購買鈕。
 * 外層 div 本身不佔版面（托盤是 fixed）；呼叫端要自己在內容底部留 var(--tray-clearance)，並用 onHeight 補上托盤比標準高的部分（lib/layout/trayReserve.ts）。
 */
export function PurchaseTray({ twoColumn, soldOut = false, dimmed = false, onCart, onBuy, onHeight }: Props) {
  const wrapRef = useTrayHeightReport(h => onHeight?.(h));
  return (
    <div ref={wrapRef} className={`md:hidden ${TRAY_DIMMED} ${twoColumn ? RIGHT_COLUMN : ''}`}>
      <GlassTray label="購買">
        <TrayButton tone="secondary" onClick={onCart} disabled={soldOut} aria-disabled={dimmed || undefined}>加入購物車</TrayButton>
        <TrayButton tone="primary" onClick={onBuy} disabled={soldOut} aria-disabled={dimmed || undefined}>{soldOut ? '已售完' : '直接購買'}</TrayButton>
      </GlassTray>
    </div>
  );
}
