import { supabase } from '../supabase';
import { fail, rpc } from './api';

// 個人檔案（暱稱）的資料庫呼叫。介面見 .work/account-payment-methods/interface.md 第 1、2.1 節。
// 沒有列＝暱稱未設定，不是錯誤；profiles 的列在第一次存暱稱時由 set_my_nickname 建立。

export interface ProfileRow { user_id: string; nickname: string | null; created_at: string; updated_at: string }

/** 讀自己的暱稱；沒設定回傳 null。RLS 只回自己的列 */
export async function fetchNickname(): Promise<string | null> {
  const { data, error } = await supabase.from('profiles').select('nickname').maybeSingle();
  if (error) return fail(error);
  return (data as { nickname: string | null } | null)?.nickname ?? null;
}

/** 設定或清除（null／空字串）暱稱，回傳存好的值。不合規則時丟 AccountError（code＝NICKNAME_INVALID） */
export async function saveNickname(nickname: string | null): Promise<string | null> {
  const row = await rpc<ProfileRow>('set_my_nickname', { p_nickname: nickname });
  return row.nickname;
}
