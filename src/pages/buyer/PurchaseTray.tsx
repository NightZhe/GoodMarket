import { GlassTray, TrayButton } from '../../components/glass';

/** 按鈕擋下（自己的商品、離線）時仍可聚焦（aria-disabled），所以托盤元件管不到它的底色，由這裡蓋過去；按下也不縮放 */
const DIMMED = [
  "[&_.tray-btn[aria-disabled='true']]:bg-canvas",
  "[&_.tray-btn[aria-disabled='true']]:text-muted-2",
  "[&_.tray-btn[aria-disabled='true']:active]:transform-none",
].join(' ');

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
};

/**
 * 商品頁購買托盤（D6、C5）：App 與手機網頁在任何寬度都固定在底部，桌機網頁（md 以上）改用右欄內的購買鈕。
 * 外層 div 本身不佔版面（托盤是 fixed）；呼叫端要自己在內容底部留 var(--tray-clearance)。
 */
export function PurchaseTray({ twoColumn, soldOut = false, dimmed = false, onCart, onBuy }: Props) {
  return (
    <div className={`md:hidden ${DIMMED} ${twoColumn ? RIGHT_COLUMN : ''}`}>
      <GlassTray label="購買">
        <TrayButton tone="secondary" onClick={onCart} disabled={soldOut} aria-disabled={dimmed || undefined}>加入購物車</TrayButton>
        <TrayButton tone="primary" onClick={onBuy} disabled={soldOut} aria-disabled={dimmed || undefined}>{soldOut ? '已售完' : '直接購買'}</TrayButton>
      </GlassTray>
    </div>
  );
}
