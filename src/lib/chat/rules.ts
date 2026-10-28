import type { StorageLike } from '../auth/pending';

// 對話頁規則提示（§10.2、AC-M38）：顯示到使用者按關閉為止；關閉後本機記住，任何對話（買家端、賣家端）都不再出現。
// 沒按關閉就離開，下次進對話頁仍顯示。壞掉或讀不到的紀錄一律當作「還沒關閉」（寧可多提醒一次）。

export const RULES_KEY = 'goodmarket_chat_rules_dismissed';

export const RULES_TEXT = '為了交易安全，請勿在對話中提供電話、LINE 等聯絡方式；站外交易不受好物集保障。';

export function rulesDismissed(store: StorageLike | null): boolean {
  try { return store?.getItem(RULES_KEY) === '1'; } catch { return false; }
}

/** 寫入失敗（例如私密模式）回 false：這次關得掉，但下次還會再出現，呼叫端不需要告訴使用者 */
export function dismissRules(store: StorageLike | null): boolean {
  try {
    if (!store) return false;
    store.setItem(RULES_KEY, '1');
    return true;
  } catch {
    return false;
  }
}

/** 讀 window.localStorage 本身就可能丟 SecurityError（封鎖所有網站資料時） */
export function browserStore(): StorageLike | null {
  try { return typeof window === 'undefined' ? null : window.localStorage; } catch { return null; }
}

/**
 * 是否顯示。只看有沒有按過關閉，不看輸入框焦點或螢幕高度：
 * 曾經因「矮螢幕鍵盤開著就收起」，使目標按鈕（重送）的 mousedown 讓輸入框失焦、提示重新出現、版面下推，點擊落空（B1）
 */
export const rulesVisible = (dismissed: boolean): boolean => !dismissed;
