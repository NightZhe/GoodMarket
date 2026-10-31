// 顯示名稱邀請（D11、spec 工單 B5）：買家在聊聊送出第一則訊息成功後、還沒有顯示名稱時，彈一次底部面板邀請設定。
// 略過後本機記住（任何店都不再彈）；儲存成功後有了名稱，自然也不再彈。賣家端永遠不彈。
// 讀寫失敗（私密模式、封鎖網站資料）一律當作「沒略過過」：寧可多問一次，也不要永遠問不到。
import type { StorageLike } from '../auth/pending';
import type { ChatSide } from './types';

export const NICKNAME_PROMPT_KEY = 'goodmarket.nicknamePromptDismissed';
/**
 * 「待邀請」旗標（sessionStorage）：第一則訊息如果同時建立了對話，網址會從 /chat/new 換成 /chat/:id，
 * 對話元件整個重新掛載，元件內的狀態留不住；所以送出成功時先記在這裡，重掛後的元件再接手顯示。
 * 值是寫入時間（ms），只在 PENDING_TTL_MS 內有效：免得查詢失敗留下的旗標在很久之後的另一條對話突然彈出來
 */
export const NICKNAME_PROMPT_PENDING_KEY = 'goodmarket.nicknamePromptPending';
export const PENDING_TTL_MS = 60_000;

export const NICKNAME_PROMPT_TITLE = '設個顯示名稱，賣家才認得你';
export const NICKNAME_PROMPT_DESC = '賣家在聊聊會看到這個名稱；評價頁會遮罩';

export function nicknamePromptDismissed(store: StorageLike | null): boolean {
  try { return store?.getItem(NICKNAME_PROMPT_KEY) === '1'; } catch { return false; }
}

/** 寫入失敗回 false：這次關得掉，下次對別家店送第一則時還會再問一次 */
export function dismissNicknamePrompt(store: StorageLike | null): boolean {
  try {
    if (!store) return false;
    store.setItem(NICKNAME_PROMPT_KEY, '1');
    return true;
  } catch {
    return false;
  }
}

export function markNicknamePromptPending(store: StorageLike | null, now: number): boolean {
  try {
    if (!store) return false;
    store.setItem(NICKNAME_PROMPT_PENDING_KEY, String(now));
    return true;
  } catch {
    return false;
  }
}

/** 讀走旗標（讀到就移除）：在有效期內才算有 */
export function takeNicknamePromptPending(store: StorageLike | null, now: number): boolean {
  try {
    const raw = store?.getItem(NICKNAME_PROMPT_PENDING_KEY);
    if (raw == null) return false;
    store?.removeItem(NICKNAME_PROMPT_PENDING_KEY);
    const at = Number(raw);
    return Number.isFinite(at) && now - at >= 0 && now - at <= PENDING_TTL_MS;
  } catch {
    return false;
  }
}

export function clearNicknamePromptPending(store: StorageLike | null): void {
  try { store?.removeItem(NICKNAME_PROMPT_PENDING_KEY); } catch { /* 讀不到就算了 */ }
}

/** 讀 window.sessionStorage 本身就可能丟 SecurityError（封鎖所有網站資料時） */
export function sessionStore(): StorageLike | null {
  try { return typeof window === 'undefined' ? null : window.sessionStorage; } catch { return null; }
}

/**
 * 送出第一則成功後要不要去查暱稱、要不要彈。
 * side：只有買家；dismissed：本機已略過就不彈；nickname：已有名稱（非空）不彈。
 * nickname 傳 undefined 代表「還沒查」——呼叫端先用 side 與 dismissed 決定要不要花一次查詢，查到再用這個函式做最後判斷
 */
export function shouldPromptNickname(s: { side: ChatSide; dismissed: boolean; nickname: string | null | undefined }): boolean {
  if (s.side !== 'buyer' || s.dismissed) return false;
  if (s.nickname === undefined) return true;
  return !(s.nickname && s.nickname.trim());
}
