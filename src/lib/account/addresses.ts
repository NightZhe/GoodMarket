import { supabase } from '../supabase';
import { composeAddress, formatPhone } from './address';
import { fail, rpc } from './api';

// 地址簿的資料庫呼叫。介面見 .work/account-payment-methods/interface.md 第 1、2.2～2.4 節。
// 寫入只有 RPC（上限、唯一預設、手機正規化都在資料庫裡）；讀取走 PostgREST，RLS 只回自己的列。

export interface AddressRow {
  id: string;
  user_id: string;
  recipient: string;
  /** 只有 10 碼數字；顯示時用 formatPhone */
  phone: string;
  city: string;
  district: string;
  postal_code: string;
  detail: string;
  is_default: boolean;
  created_at: string;
  updated_at: string;
}

export interface AddressInput {
  /** null＝新增；有值＝編輯那一筆 */
  id: string | null;
  recipient: string;
  phone: string;
  city: string;
  district: string;
  zip: string;
  detail: string;
  isDefault: boolean;
}

/** 預設排第一，其餘依最近更新 */
export async function fetchAddresses(): Promise<AddressRow[]> {
  const { data, error } = await supabase.from('addresses').select('*')
    .order('is_default', { ascending: false }).order('updated_at', { ascending: false });
  if (error) return fail(error);
  return data as AddressRow[];
}

export const saveAddress = (i: AddressInput) =>
  rpc<AddressRow>('save_address', {
    p_id: i.id, p_recipient: i.recipient, p_phone: i.phone, p_city: i.city, p_district: i.district,
    p_postal_code: i.zip, p_detail: i.detail, p_is_default: i.isDefault,
  });

export const setDefaultAddress = (id: string) => rpc<AddressRow>('set_default_address', { p_id: id });

export const deleteAddress = async (id: string): Promise<void> => { await rpc<null>('delete_address', { p_id: id }); };

/** 列上顯示的完整地址（R-A19 格式）；舊資料照存的原文 */
export const addressLine = (a: AddressRow): string =>
  composeAddress({ zip: a.postal_code, city: a.city, district: a.district, detail: a.detail });

export const phoneText = (a: Pick<AddressRow, 'phone'>): string => formatPhone(a.phone);
