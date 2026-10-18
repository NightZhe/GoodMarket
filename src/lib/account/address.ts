import { hasRegion } from './regions';

// 地址欄位的規則（R-A6）與訂單地址組合（R-A19）。全部是純函式，畫面與測試共用。
// 這裡只是即時提示；最後以資料庫的檢查為準（interface.md 第 2.2 節）。

export const RECIPIENT_MAX = 20;
export const DETAIL_MIN = 2;
/** 縣市＋鄉鎮市區＋詳細地址合計（code point） */
export const ADDRESS_TOTAL_MAX = 60;
export const ADDRESS_LIMIT = 10;

export interface AddressDraft {
  recipient: string;
  phone: string;
  city: string;
  district: string;
  detail: string;
}

export type AddressField = 'recipient' | 'phone' | 'city' | 'district' | 'detail';
export type AddressErrors = Partial<Record<AddressField, string>>;

export const EMPTY_DRAFT: AddressDraft = { recipient: '', phone: '', city: '', district: '', detail: '' };

/** 字數一律用 code point：資料庫是 char_length，s.length 會把 emoji 與擴充區漢字算成 2 */
const len = (s: string) => [...s].length;

const PHONE = /^09\d{2}-?\d{3}-?\d{3}$/;

/** 手機 → 10 碼數字。連字號只收標準位置；中間空白、全形、+886、市話一律 null（不悄悄吞掉，伺服器也拒絕） */
export function normalizePhone(raw: string): string | null {
  const v = raw.trim();
  return PHONE.test(v) ? v.replace(/-/g, '') : null;
}

/** 0912345678 → 0912-345-678。不是 10 碼數字就原樣回傳 */
export const formatPhone = (digits: string): string =>
  /^\d{10}$/.test(digits) ? `${digits.slice(0, 4)}-${digits.slice(4, 7)}-${digits.slice(7)}` : digits;

/** 縣市＋區＋詳細地址（去前後空白）的字數；縣市、區還沒選時只算已有的部分 */
export const addressLength = (d: Pick<AddressDraft, 'city' | 'district' | 'detail'>): number =>
  len(d.city) + len(d.district) + len(d.detail.trim());

export function validateAddress(d: AddressDraft): AddressErrors {
  const e: AddressErrors = {};

  const name = d.recipient.trim();
  if (name === '') e.recipient = '請填寫收件人';
  else if (len(name) > RECIPIENT_MAX) e.recipient = `收件人最多 ${RECIPIENT_MAX} 個字`;

  const phone = d.phone.trim();
  if (phone === '') e.phone = '請填寫手機號碼';
  else if (normalizePhone(phone) === null) e.phone = '手機號碼要是 09 開頭的 10 碼，例如 0912-345-678';

  if (d.city === '') e.city = '請選擇縣市';
  else if (!hasRegion(d.city, d.district)) e.district = '請選擇鄉鎮市區';

  const detail = d.detail.trim();
  if (detail === '') e.detail = '請填寫詳細地址';
  else if (len(detail) < DETAIL_MIN) e.detail = `詳細地址至少 ${DETAIL_MIN} 個字`;
  else if (addressLength(d) > ADDRESS_TOTAL_MAX) {
    e.detail = `地址太長：縣市、區加詳細地址合計最多 ${ADDRESS_TOTAL_MAX} 字，目前多了 ${addressLength(d) - ADDRESS_TOTAL_MAX} 字`;
  }
  return e;
}

const SERVER_FIELD: Record<string, AddressField> = {
  ADDRESS_RECIPIENT_INVALID: 'recipient',
  ADDRESS_PHONE_INVALID: 'phone',
  ADDRESS_REGION_INVALID: 'city',
  ADDRESS_DETAIL_INVALID: 'detail',
  ADDRESS_TOO_LONG: 'detail',
};

/** 伺服器回的欄位類錯誤碼（error.hint）綁回哪個欄位；非欄位類（上限、找不到、預設保護）回傳 null */
export const fieldOfServerError = (code: string | null): AddressField | null => (code ? SERVER_FIELD[code] ?? null : null);

/** 詳細地址開頭又打了已選的縣市或區：提示就好，不擋儲存 */
export function detailRepeatsRegion(d: Pick<AddressDraft, 'city' | 'district' | 'detail'>): boolean {
  const detail = d.detail.trim();
  return [d.city, d.district].some(x => x !== '' && detail.startsWith(x));
}

/** 選縣市：改成別的縣市時，已選的區與郵遞區號作廢（AC-A33）；重選同一個不動 */
export const selectCity = (d: AddressDraft, city: string): AddressDraft =>
  city === d.city ? d : { ...d, city, district: '' };

/** 詳細地址是單行：換行與 tab 轉成空白（貼上多行文字時） */
export const oneLine = (s: string): string => s.replace(/[\r\n\t]+/g, ' ');

export interface AddressParts { zip: string; city: string; district: string; detail: string }

/** R-A19：訂單收件地址快照＝「郵遞區號 縣市區詳細地址」 */
export const composeAddress = (p: AddressParts): string => `${p.zip} ${p.city}${p.district}${p.detail.trim()}`;
