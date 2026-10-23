import { rpc } from '../account/api';
import { parseReturnInfo, type ReturnInfo } from './returnInfoView';
import { parseReturnSettings, type ReturnAddress, type ReturnSettings, type ReturnStore } from './returnStore';

// 退貨地址（物流設定）的資料庫呼叫，介面見 .work/seller-logistics/interface-logistics.md。
// 全部走 RPC；錯誤由 account/api 的 rpc() 轉成 AccountError（hint＝機器代碼，message＝可直接顯示的中文；
// PGRST202＝資料庫還沒套 migration → kind 'backend_missing'，R-L17）。

/** 店主讀自己店的全部設定（沒有直接讀表的路徑） */
export const fetchReturnSettings = async (): Promise<ReturnSettings> =>
  parseReturnSettings(await rpc<unknown>('get_my_return_settings'));

export interface ReturnStoreInput {
  /** null＝新增；有值＝編輯那一筆 */
  id: string | null;
  /** 品牌代碼（brands.ts） */
  brand: string;
  storeName: string;
  recipient: string;
  /** 10 碼數字或帶連字號都行；資料庫存 10 碼 */
  phone: string;
  city: string;
  district: string;
  zip: string;
  detail: string;
  isDefault: boolean;
}

export const saveReturnStore = (i: ReturnStoreInput) =>
  rpc<ReturnStore>('save_return_store', {
    p_id: i.id, p_brand: i.brand, p_store_name: i.storeName, p_recipient: i.recipient, p_phone: i.phone,
    p_city: i.city, p_district: i.district, p_postal_code: i.zip, p_detail: i.detail, p_is_default: i.isDefault,
  });

export const setDefaultReturnStore = (id: string) => rpc<ReturnStore>('set_default_return_store', { p_id: id });

export const deleteReturnStore = async (id: string): Promise<void> => { await rpc<null>('delete_return_store', { p_id: id }); };

export interface ReturnAddressInput {
  recipient: string;
  phone: string;
  city: string;
  district: string;
  zip: string;
  detail: string;
}

export const saveReturnPersonalAddress = (i: ReturnAddressInput) =>
  rpc<ReturnAddress>('save_return_personal_address', {
    p_recipient: i.recipient, p_phone: i.phone, p_city: i.city, p_district: i.district, p_postal_code: i.zip, p_detail: i.detail,
  });

export const deleteReturnPersonalAddress = async (): Promise<void> => { await rpc<null>('delete_return_personal_address'); };

/** 傳空字串（或只有空白）＝清除；回傳存好的內容（清除時 note＝null） */
export const saveReturnNote = (note: string) => rpc<{ note: string | null }>('set_return_note', { p_note: note });

/** 買家：只在要看某張訂單的退貨資訊時呼叫（不要在訂單列表逐張呼叫，R-L13）。L-A2 用 */
export const fetchOrderReturnInfo = async (orderId: string): Promise<ReturnInfo> =>
  parseReturnInfo(await rpc<unknown>('get_order_return_info', { p_order: orderId }));
