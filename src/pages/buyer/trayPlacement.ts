/**
 * 底部托盤在展開橫向、書本（D13、Q3）改落在折線右側。規則（含橫向寬 ≥ 760 的門檻）在 index.css 的 .fold-tray，與 .fold-panel 同一個門檻；
 * 掛在托盤外層元素上即可。與 PurchaseTray 的兩欄規則同一個算法，那邊要多一個「兩欄」條件所以另寫
 */
export const TRAY_RIGHT_HALF = 'fold-tray';

/** 按鈕被擋下但仍可聚焦（aria-disabled）時，托盤元件管不到底色，由掛的元素蓋過去；按下也不縮放。與 PurchaseTray 同一組 */
export const TRAY_DIMMED = [
  "[&_.tray-btn[aria-disabled='true']]:bg-canvas",
  "[&_.tray-btn[aria-disabled='true']]:text-muted-2",
  "[&_.tray-btn[aria-disabled='true']:active]:transform-none",
].join(' ');
