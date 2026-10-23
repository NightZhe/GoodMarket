import { composeAddress, fieldOfServerError, tidyDetail, validateAddress, type AddressDraft, type AddressField } from '../account/address';
import { brandLabel, isBrandCode } from './brands';

// 賣家的退貨門市／個人地址：型別、欄位驗證、伺服器錯誤碼對欄位。全部是純函式，畫面與測試共用。
// 這裡只是即時提示；最後以資料庫的檢查為準（.work/seller-logistics/interface-logistics.md）。

export const STORE_LIMIT = 5;
export const STORE_NAME_MAX = 20;

/** 店主看到的退貨門市（get_my_return_settings／save_return_store 的回傳；欄位名是 snake_case） */
export interface ReturnStore {
  id: string;
  brand: string;
  store_name: string;
  recipient: string;
  /** 10 碼數字；顯示時用 formatPhone */
  phone: string;
  city: string;
  district: string;
  postal_code: string;
  detail: string;
  is_default: boolean;
  created_at: string;
  updated_at: string;
}

/** 店主看到的個人地址（每店至多一筆，沒有 id、沒有預設概念） */
export interface ReturnAddress {
  recipient: string;
  phone: string;
  city: string;
  district: string;
  postal_code: string;
  detail: string;
  created_at: string;
  updated_at: string;
}

export interface ReturnSettings {
  stores: ReturnStore[];
  personal: ReturnAddress | null;
  note: string | null;
}

/** 讀取狀態：unavailable＝資料庫還沒套 migration（R-L17）；error＝網路或伺服器失敗 */
export type ReturnReadPhase = 'loading' | 'ready' | 'error' | 'unavailable';

/** 門市表單的草稿：地址五欄沿用地址簿，再加品牌（代碼）與門市名稱 */
export interface StoreDraft extends AddressDraft {
  brand: string;
  storeName: string;
}

export type StoreOnlyField = 'brand' | 'storeName';
export type StoreField = StoreOnlyField | AddressField;
export type StoreErrors = Partial<Record<StoreField, string>>;
/** 伺服器錯誤碼能綁到的欄位（含退貨說明） */
export type LogisticsField = StoreField | 'note';

/** 字數一律用 code point：資料庫是 char_length，s.length 會把 emoji 與擴充區漢字算成 2 */
const len = (s: string) => [...s].length;

export function validateStoreFields(d: Pick<StoreDraft, 'brand' | 'storeName'>): Partial<Record<StoreOnlyField, string>> {
  const e: Partial<Record<StoreOnlyField, string>> = {};
  if (!isBrandCode(d.brand)) e.brand = '請選擇超商品牌';
  const name = tidyDetail(d.storeName);
  if (name === '') e.storeName = '請填寫門市名稱';
  else if (len(name) > STORE_NAME_MAX) e.storeName = `門市名稱最多 ${STORE_NAME_MAX} 個字`;
  return e;
}

export const validateStore = (d: StoreDraft): StoreErrors => ({ ...validateStoreFields(d), ...validateAddress(d) });

/** 表單由上到下的欄位順序＝焦點順序（設計 5.1）；按儲存時焦點移到第一個有錯的 */
export const STORE_FIELD_ORDER: readonly StoreField[] = ['brand', 'storeName', 'city', 'district', 'detail', 'recipient', 'phone'];

export const firstStoreError = (errors: StoreErrors): StoreField | null => STORE_FIELD_ORDER.find(f => errors[f]) ?? null;

const SERVER_FIELD: Record<string, LogisticsField> = {
  RETURN_STORE_BRAND_INVALID: 'brand',
  RETURN_STORE_NAME_INVALID: 'storeName',
  RETURN_NOTE_TOO_LONG: 'note',
  RETURN_NOTE_INVALID: 'note',
};

/** 伺服器回的欄位類錯誤碼（error.hint）綁回哪個欄位；非欄位類（上限、找不到、預設保護、沒登入）回傳 null */
export const fieldOfLogisticsError = (code: string | null): LogisticsField | null =>
  code ? SERVER_FIELD[code] ?? fieldOfServerError(code) : null;

/** 「{品牌} {門市名稱}」：列標題、按鈕名稱、對話框標題共用 */
export const storeTitle = (s: Pick<ReturnStore, 'brand' | 'store_name'>): string => `${brandLabel(s.brand)} ${s.store_name}`;

/** 列上顯示的地址（郵遞區號 縣市區詳細地址）；舊資料照存的原文 */
export const storeAddressLine = (a: Pick<ReturnStore | ReturnAddress, 'postal_code' | 'city' | 'district' | 'detail'>): string =>
  composeAddress({ zip: a.postal_code, city: a.city, district: a.district, detail: a.detail });

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** RPC 回傳 → 固定形狀。欄位缺了或型別不對就當作沒設，不丟錯；預設門市排最前，其餘維持伺服器的順序 */
export function parseReturnSettings(raw: unknown): ReturnSettings {
  const o = isRecord(raw) ? raw : {};
  const list = Array.isArray(o.stores) ? (o.stores as ReturnStore[]) : [];
  const stores = [...list.filter(s => s.is_default), ...list.filter(s => !s.is_default)];
  return {
    stores,
    personal: isRecord(o.personal) ? (o.personal as unknown as ReturnAddress) : null,
    note: typeof o.note === 'string' ? o.note : null,
  };
}
