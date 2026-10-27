/**
 * 底部托盤在「橫向且寬度 ≥ 760」（展開橫向、書本，D13、Q3）改落在折線右側：把內容欄左緣挪到右半的中線帶外緣，托盤自己置中在剩下的右半。
 * 掛在托盤外層元素上；直向與寬度 < 760 不套用。門檻不用 .fold-panel 的 620：外蓋橫向是 678×466（沒有折線），
 * 系統欄 84 在右時右半只剩 231，結帳托盤的按鈕會被擠到 57 寬；760 以下維持置中在內容欄。
 * 與 PurchaseTray 的兩欄規則同一個算法，那邊要多一個「兩欄」條件所以另寫
 */
export const TRAY_RIGHT_HALF = 'min-[760px]:landscape:[--inset-l:calc(50vw+var(--midline-half))]';

/** 按鈕被擋下但仍可聚焦（aria-disabled）時，托盤元件管不到底色，由掛的元素蓋過去；按下也不縮放。與 PurchaseTray 同一組 */
export const TRAY_DIMMED = [
  "[&_.tray-btn[aria-disabled='true']]:bg-canvas",
  "[&_.tray-btn[aria-disabled='true']]:text-muted-2",
  "[&_.tray-btn[aria-disabled='true']:active]:transform-none",
].join(' ');
