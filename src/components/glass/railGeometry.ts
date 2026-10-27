/**
 * 直立軌的幾何數字（pt）。JS 端的唯一來源：railLevel.ts 靠它算層級。
 * CSS 端的來源是 index.css :root 的 --rail-pad／--rail-cap-w／--rail-center／--cell-h／--cell-h-compact，tabs.tsx 的 class 只讀變數；
 * railGeometry.test.ts 把兩端釘在一起，改這裡要同步改 index.css，否則測試失敗。
 */
/** 膠囊上下內距（左右 0） */
export const RAIL_PAD = 6;
/** 直立軌膠囊寬，也是 L2「目前分頁」鈕的邊長 */
export const RAIL_CAP_W = 48;
/** 直立軌中心線距離系統欄那側的螢幕邊（X10：對齊系統島，不是欄寬 84 的一半）；左右姿態鏡像 */
export const RAIL_CENTER = 48;
/** 分頁格高：圖示＋標籤（L0、水平膠囊） */
export const CELL_LABELED = 50;
/** 分頁格高：純圖示（L1，也是 44 觸控目標） */
export const CELL_COMPACT = 44;
