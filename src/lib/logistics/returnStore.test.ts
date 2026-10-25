import { describe, expect, it } from 'vitest';
import {
  STORE_FIELD_ORDER, STORE_LIMIT, STORE_NAME_MAX, fieldOfLogisticsError, firstStoreError, parseReturnSettings,
  storeAddressLine, storeTitle, validateStore, validateStoreFields, type StoreDraft, type ReturnStore,
} from './returnStore';

const ok: StoreDraft = {
  brand: 'seven_eleven', storeName: '好物門市', recipient: '王小明', phone: '0912-345-678',
  city: '臺北市', district: '大安區', detail: '忠孝東路四段1號',
};
const with_ = (p: Partial<StoreDraft>): StoreDraft => ({ ...ok, ...p });

const store = (p: Partial<ReturnStore> = {}): ReturnStore => ({
  id: 'a', brand: 'familymart', store_name: '小花門市', recipient: '李小華', phone: '0987654321',
  city: '新北市', district: '板橋區', postal_code: '220', detail: '文化路一段1號', is_default: false,
  created_at: '2026-10-23T00:00:00Z', updated_at: '2026-10-23T00:00:00Z', ...p,
});

describe('門市欄位驗證（AC-L8）', () => {
  it('完整合法的資料沒有任何錯誤', () => {
    expect(validateStore(ok)).toEqual({});
  });
  it('品牌沒選 → 請選擇超商品牌；不是四個代碼之一也擋', () => {
    expect(validateStore(with_({ brand: '' })).brand).toBe('請選擇超商品牌');
    expect(validateStore(with_({ brand: '7-ELEVEN' })).brand).toBe('請選擇超商品牌');
  });
  it('門市名稱：空白（含只有空白）→ 請填寫門市名稱', () => {
    expect(validateStore(with_({ storeName: '' })).storeName).toBe('請填寫門市名稱');
    expect(validateStore(with_({ storeName: '　 　' })).storeName).toBe('請填寫門市名稱');
  });
  it('門市名稱：20 字可以、21 字不行（code point，去頭尾空白）', () => {
    expect(STORE_NAME_MAX).toBe(20);
    expect(validateStore(with_({ storeName: '字'.repeat(20) })).storeName).toBeUndefined();
    expect(validateStore(with_({ storeName: ` ${'字'.repeat(20)} ` })).storeName).toBeUndefined();
    expect(validateStore(with_({ storeName: '字'.repeat(21) })).storeName).toBe('門市名稱最多 20 個字');
  });
  it('門市名稱：emoji 與擴充區漢字算 1 個字，不是 2', () => {
    expect(validateStore(with_({ storeName: '😀'.repeat(20) })).storeName).toBeUndefined();
    expect(validateStore(with_({ storeName: '𠮷'.repeat(21) })).storeName).toBe('門市名稱最多 20 個字');
  });
  it('地址部分沿用地址簿的驗證：收件人、手機、縣市區、詳細地址、合計 60 字', () => {
    expect(validateStore(with_({ recipient: '' })).recipient).toBe('請填寫收件人');
    expect(validateStore(with_({ phone: '0812345678' })).phone).toBe('手機號碼要是 09 開頭的 10 碼，例如 0912-345-678');
    expect(validateStore(with_({ city: '' })).city).toBe('請選擇縣市');
    expect(validateStore(with_({ district: '' })).district).toBe('請選擇鄉鎮市區');
    expect(validateStore(with_({ detail: '路' })).detail).toBe('詳細地址至少 2 個字');
    expect(validateStore(with_({ detail: '路'.repeat(55) })).detail).toMatch(/^地址太長/);
  });
  it('全部都空白：每個欄位各一個錯誤', () => {
    const e = validateStore({ brand: '', storeName: '', recipient: '', phone: '', city: '', district: '', detail: '' });
    expect(Object.keys(e).sort()).toEqual(['brand', 'city', 'detail', 'phone', 'recipient', 'storeName']);
  });
  it('validateStoreFields 只看品牌與名稱', () => {
    expect(validateStoreFields({ brand: '', storeName: '' })).toEqual({ brand: '請選擇超商品牌', storeName: '請填寫門市名稱' });
    expect(validateStoreFields({ brand: 'okmart', storeName: '好' })).toEqual({});
  });
});

describe('焦點順序＝畫面順序（設計 5.1）', () => {
  it('品牌 → 名稱 → 縣市 → 區 → 詳細地址 → 收件人 → 手機', () => {
    expect(STORE_FIELD_ORDER).toEqual(['brand', 'storeName', 'city', 'district', 'detail', 'recipient', 'phone']);
  });
  it('firstStoreError 取畫面上最前面的那個錯誤', () => {
    expect(firstStoreError({ phone: 'x', recipient: 'y' })).toBe('recipient');
    expect(firstStoreError({ detail: 'x', brand: 'y', phone: 'z' })).toBe('brand');
    expect(firstStoreError({})).toBeNull();
  });
});

describe('伺服器錯誤碼 → 欄位（設計 5.4、interface 2.2）', () => {
  it('門市類', () => {
    expect(fieldOfLogisticsError('RETURN_STORE_BRAND_INVALID')).toBe('brand');
    expect(fieldOfLogisticsError('RETURN_STORE_NAME_INVALID')).toBe('storeName');
  });
  it('地址類沿用 fieldOfServerError', () => {
    expect(fieldOfLogisticsError('ADDRESS_RECIPIENT_INVALID')).toBe('recipient');
    expect(fieldOfLogisticsError('ADDRESS_PHONE_INVALID')).toBe('phone');
    expect(fieldOfLogisticsError('ADDRESS_REGION_INVALID')).toBe('city');
    expect(fieldOfLogisticsError('ADDRESS_DETAIL_INVALID')).toBe('detail');
    expect(fieldOfLogisticsError('ADDRESS_TOO_LONG')).toBe('detail');
  });
  it('退貨說明的兩個碼都綁 note', () => {
    expect(fieldOfLogisticsError('RETURN_NOTE_TOO_LONG')).toBe('note');
    expect(fieldOfLogisticsError('RETURN_NOTE_INVALID')).toBe('note');
  });
  it('非欄位類（上限、找不到、預設保護、沒登入）與 null 回 null', () => {
    for (const c of ['RETURN_STORE_LIMIT_REACHED', 'RETURN_STORE_NOT_FOUND', 'RETURN_STORE_DEFAULT_PROTECTED', 'NOT_AUTHENTICATED', 'NO_SHOP', null]) {
      expect(fieldOfLogisticsError(c), String(c)).toBeNull();
    }
  });
  it('上限是 5', () => expect(STORE_LIMIT).toBe(5));
});

describe('列表顯示', () => {
  it('標題＝品牌字樣＋門市名稱', () => {
    expect(storeTitle(store({ brand: 'seven_eleven', store_name: '好物門市' }))).toBe('7-ELEVEN 好物門市');
  });
  it('地址行＝郵遞區號 縣市區詳細地址', () => {
    expect(storeAddressLine(store())).toBe('220 新北市板橋區文化路一段1號');
  });
});

describe('parseReturnSettings：把 RPC 回傳整理成固定形狀', () => {
  it('三個 key 都在；預設門市排最前，其餘維持原順序', () => {
    const s = parseReturnSettings({
      stores: [store({ id: 'a' }), store({ id: 'b', is_default: true }), store({ id: 'c' })],
      personal: null, note: '請先聯絡',
    });
    expect(s.stores.map(x => x.id)).toEqual(['b', 'a', 'c']);
    expect(s.personal).toBeNull();
    expect(s.note).toBe('請先聯絡');
  });
  it('缺 key、null、非物件：當作什麼都沒設，不丟錯', () => {
    for (const raw of [null, undefined, {}, 'x', 5]) {
      expect(parseReturnSettings(raw), String(raw)).toEqual({ stores: [], personal: null, note: null });
    }
  });
  it('stores 不是陣列也不丟錯', () => {
    expect(parseReturnSettings({ stores: 'x' }).stores).toEqual([]);
  });
});
