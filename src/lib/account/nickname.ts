import type { NicknamePrefill } from '../auth/identity';
import { normalizeNickname, validateNickname } from '../reviews/nickname';

export type NicknamePrefillSource = 'profile' | 'google';
export type ResolvedPrefill = NicknamePrefill & { source: NicknamePrefillSource };

/**
 * 評價暱稱的預填順序（spec 5.8 第 5 點）：個人檔案的暱稱 → Google 名稱 → 空白。
 * saved：個人檔案的暱稱。null＝沒設；undefined＝讀取失敗，退回現況（Google 名稱或空白），不擋評價。
 * 資料庫的暱稱理論上一定合規；萬一不合規就不預填它，避免使用者什麼都沒改卻送不出去。
 */
export function resolveNicknamePrefill(saved: string | null | undefined, google: NicknamePrefill | null): ResolvedPrefill | null {
  const check = typeof saved === 'string' ? validateNickname(saved) : null;
  if (check?.ok && check.value) return { value: check.value, original: check.value, adjusted: false, source: 'profile' };
  return google ? { ...google, source: 'google' } : null;
}

/** 個人檔案頁儲存鈕：輸入值（去頭尾空白）與已存值不同才算有改動；兩者皆空＝沒改動 */
export const nicknameDirty = (input: string, saved: string | null): boolean =>
  normalizeNickname(input) !== (saved ?? '');
