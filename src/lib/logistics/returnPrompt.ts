import type { ReturnReadPhase, ReturnSettings } from './returnStore';

// 賣場總覽的「尚未設定退貨地址」提示卡與手機常駐入口列的出現條件（R-L16、設計 7.1～7.2）。L-A2 的 SellerDashboard 用。

/**
 * 門市與個人地址都是 0 筆才顯示；只有退貨說明不算設定。
 * 讀取中、失敗、資料庫未升級一律不顯示：這是提醒不是功能，寧可漏提醒也不誤報（H-L5）。
 */
export const shouldShowReturnPrompt = (phase: ReturnReadPhase, settings: ReturnSettings | null): boolean =>
  phase === 'ready' && settings !== null && settings.stores.length === 0 && settings.personal === null;

/** 手機版的常駐「物流設定」入口列：提示卡沒有顯示的時候才出現（卡顯示時卡就是入口） */
export const shouldShowEntryRow = (phase: ReturnReadPhase, settings: ReturnSettings | null): boolean =>
  !shouldShowReturnPrompt(phase, settings);
