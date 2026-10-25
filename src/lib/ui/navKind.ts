import type { NavigationType } from 'react-router-dom';
import type { RevealNav } from './revealPolicy';

/** react-router 的 NavigationType 是 enum；轉成字串字面值聯集，測試與呼叫端才能直接寫 'POP' */
type NavType = `${NavigationType}`;

/**
 * 導覽種類判斷。react-router 在首次載入、重新整理、同分頁重開網址時也回報 POP，
 * 但那些不是「返回」：只有這份文件內已經發生過 PUSH／REPLACE 導覽之後的 POP，
 * 才是瀏覽器上一頁或 iOS 邊緣滑回。
 */

/** 純邏輯：這次導覽算不算返回 */
export function navKindOf(type: NavType, navigatedBefore: boolean): RevealNav {
  return type === 'POP' && navigatedBefore ? 'back' : 'go';
}

// 整份文件共用一個旗標：重新整理會重新載入模組，旗標自然歸零
let navigated = false;

/** 每次導覽完成後呼叫（App 層的 ScrollToTop）。PUSH／REPLACE 之後，下一個 POP 才算返回 */
export function recordNavigation(type: NavType) {
  if (type !== 'POP') navigated = true;
}

/** 目前這次導覽的種類，供 render 中讀取 */
export function currentNavKind(type: NavType): RevealNav {
  return navKindOf(type, navigated);
}
