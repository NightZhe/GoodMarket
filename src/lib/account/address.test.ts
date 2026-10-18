import { describe, expect, it } from 'vitest';
import {
  ADDRESS_TOTAL_MAX, addressLength, fieldOfServerError, composeAddress, detailRepeatsRegion, formatPhone, normalizePhone,
  oneLine, selectCity, tidyDetail, validateAddress, type AddressDraft,
} from './address';

const ok: AddressDraft = { recipient: '王小明', phone: '0912-345-678', city: '臺北市', district: '大安區', detail: '忠孝東路四段1號5樓' };
const with_ = (p: Partial<AddressDraft>): AddressDraft => ({ ...ok, ...p });

describe('手機正規化與顯示（AC-A13、interface.md 第 5 節）', () => {
  it('四種標準連字號位置都接受，存成 10 碼數字', () => {
    for (const raw of ['0912345678', '0912-345678', '0912345-678', '0912-345-678']) expect(normalizePhone(raw)).toBe('0912345678');
  });
  it('前後空白去掉', () => {
    expect(normalizePhone('  0912345678 ')).toBe('0912345678');
  });
  it('規格列的壞例子與不接受的寫法都回傳 null', () => {
    for (const raw of ['0812345678', '091234567', '0912-345-6789', '0912 345 678', '+886912345678', '０９１２３４５６７８', '0223456789', '', '0912-34-5678']) {
      expect(normalizePhone(raw), raw).toBeNull();
    }
  });
  it('顯示成 0912-345-678；不是 10 碼就原樣顯示，不亂切', () => {
    expect(formatPhone('0912345678')).toBe('0912-345-678');
    expect(formatPhone('12345')).toBe('12345');
  });
});

describe('字數用 code point，合計 60 字（R-A6）', () => {
  it('縣市＋區＋詳細地址（去前後空白）的 code point 數', () => {
    // 臺北市(3)＋大安區(3)＋「忠孝東路四段1號5樓」(10)
    expect(addressLength(ok)).toBe(16);
    expect(addressLength(with_({ detail: '  忠孝東路  ' }))).toBe(3 + 3 + 4);
  });
  it('emoji 與擴充區漢字算 1 個字，不是 2', () => {
    expect(addressLength(with_({ city: '', district: '', detail: '𠮷😀' }))).toBe(2);
  });
  it('縣市、區還沒選時只算詳細地址', () => {
    expect(addressLength(with_({ city: '', district: '', detail: 'abcd' }))).toBe(4);
  });
});

describe('validateAddress（逐欄文案照設計 6.4）', () => {
  it('全部正確 → 沒有錯誤', () => {
    expect(validateAddress(ok)).toEqual({});
  });
  it('收件人：空白、20 字可、21 字不行', () => {
    expect(validateAddress(with_({ recipient: '   ' })).recipient).toBe('請填寫收件人');
    expect(validateAddress(with_({ recipient: '王'.repeat(20) })).recipient).toBeUndefined();
    expect(validateAddress(with_({ recipient: '王'.repeat(21) })).recipient).toBe('收件人最多 20 個字');
    expect(validateAddress(with_({ recipient: '😀'.repeat(20) })).recipient).toBeUndefined();
  });
  it('手機：空白與格式錯誤是兩句不同的話', () => {
    expect(validateAddress(with_({ phone: '' })).phone).toBe('請填寫手機號碼');
    for (const phone of ['0812345678', '091234567', '0912-345-6789']) {
      expect(validateAddress(with_({ phone })).phone, phone).toBe('手機號碼要是 09 開頭的 10 碼，例如 0912-345-678');
    }
  });
  it('縣市沒選只報縣市；縣市選了、區沒選才報區', () => {
    const none = validateAddress(with_({ city: '', district: '' }));
    expect(none.city).toBe('請選擇縣市');
    expect(none.district).toBeUndefined();
    expect(validateAddress(with_({ district: '' })).district).toBe('請選擇鄉鎮市區');
  });
  it('區不屬於所選縣市（改縣市後沒清）視同沒選區', () => {
    expect(validateAddress(with_({ city: '桃園市', district: '大安區' })).district).toBe('請選擇鄉鎮市區');
  });
  it('詳細地址：空白、1 個字、2 個字可以', () => {
    expect(validateAddress(with_({ detail: '' })).detail).toBe('請填寫詳細地址');
    expect(validateAddress(with_({ detail: ' 路 ' })).detail).toBe('詳細地址至少 2 個字');
    expect(validateAddress(with_({ detail: '路一' })).detail).toBeUndefined();
  });
  it('合計 60 字剛好可以、61 字報「多了 1 字」（AC-A13）', () => {
    const base = addressLength(with_({ detail: '' })); // 臺北市大安區 = 6
    expect(validateAddress(with_({ detail: '甲'.repeat(ADDRESS_TOTAL_MAX - base) })).detail).toBeUndefined();
    expect(validateAddress(with_({ detail: '甲'.repeat(ADDRESS_TOTAL_MAX - base + 1) })).detail)
      .toBe('地址太長：縣市、區加詳細地址合計最多 60 字，目前多了 1 字');
  });
});

describe('地址組合 R-A19（AC-A35）', () => {
  it('郵遞區號、空格、縣市、區、詳細地址', () => {
    expect(composeAddress({ zip: '106', city: '臺北市', district: '大安區', detail: '忠孝東路四段1號5樓' }))
      .toBe('106 臺北市大安區忠孝東路四段1號5樓');
  });
  it('詳細地址去前後空白', () => {
    expect(composeAddress({ zip: '320', city: '桃園市', district: '中壢區', detail: '  中正路1號 ' })).toBe('320 桃園市中壢區中正路1號');
  });
});

describe('詳細地址重複縣市或區的提示（不擋儲存）', () => {
  it('開頭又打了已選的縣市或區 → true', () => {
    expect(detailRepeatsRegion(with_({ detail: '臺北市忠孝東路' }))).toBe(true);
    expect(detailRepeatsRegion(with_({ detail: '大安區忠孝東路' }))).toBe(true);
    expect(detailRepeatsRegion(with_({ detail: ' 臺北市大安區忠孝東路' }))).toBe(true);
  });
  it('只是中間出現，或還沒選縣市 → false', () => {
    expect(detailRepeatsRegion(with_({ detail: '忠孝東路四段大安區' }))).toBe(false);
    expect(detailRepeatsRegion(with_({ city: '', district: '', detail: '臺北市忠孝東路' }))).toBe(false);
  });
});

describe('改縣市清空區（AC-A33）', () => {
  it('已選區後改縣市：區清空、其餘欄位不動，儲存前要重選', () => {
    const next = selectCity(ok, '桃園市');
    expect(next).toEqual({ ...ok, city: '桃園市', district: '' });
    expect(validateAddress(next).district).toBe('請選擇鄉鎮市區');
  });
  it('重選同一個縣市：不清空', () => {
    expect(selectCity(ok, '臺北市')).toBe(ok);
  });
});

describe('詳細地址是單行：換行與 tab 轉成空白', () => {
  it('貼上多行文字不會留下換行', () => {
    expect(oneLine('忠孝東路\n四段1號\r\n5樓')).toBe('忠孝東路 四段1號 5樓');
  });
});

// 伺服器錯誤碼（interface.md 第 3 節）→ 綁回欄位；其餘（上限、找不到、預設保護）由畫面各自處理
describe('fieldOfServerError', () => {
  it('欄位類錯誤碼綁回對應欄位', () => {
    expect(fieldOfServerError('ADDRESS_RECIPIENT_INVALID')).toBe('recipient');
    expect(fieldOfServerError('ADDRESS_PHONE_INVALID')).toBe('phone');
    expect(fieldOfServerError('ADDRESS_DETAIL_INVALID')).toBe('detail');
    expect(fieldOfServerError('ADDRESS_TOO_LONG')).toBe('detail');
    expect(fieldOfServerError('ADDRESS_REGION_INVALID')).toBe('city');
  });
  it('非欄位錯誤碼與沒有代碼＝null', () => {
    for (const c of ['ADDRESS_LIMIT_REACHED', 'ADDRESS_NOT_FOUND', 'ADDRESS_DEFAULT_PROTECTED', 'NOT_AUTHENTICATED', null]) {
      expect(fieldOfServerError(c), String(c)).toBeNull();
    }
  });
});

// 伺服器對含換行的詳細地址只會回「至少需要 2 個字」（原因不符）：送出前先整理成單一空白，不讓換行到伺服器
describe('tidyDetail：送出前整理詳細地址', () => {
  it('換行、tab、連續空白（含全形與 NBSP）整理成單一空白，去頭尾', () => {
    expect(tidyDetail(' 忠孝東路\n四段1號\r\n\n5樓 ')).toBe('忠孝東路 四段1號 5樓');
    expect(tidyDetail('忠孝東路   四段\u00a0\u30001號')).toBe('忠孝東路 四段 1號');
    expect(tidyDetail('忠孝東路\t四段')).toBe('忠孝東路 四段');
  });
  it('其他控制字元（伺服器也拒絕）一併轉成空白', () => {
    expect(tidyDetail('忠孝\u0000東路\u007f四段')).toBe('忠孝 東路 四段');
  });
  it('一般地址不變', () => {
    expect(tidyDetail('忠孝東路四段1號5樓')).toBe('忠孝東路四段1號5樓');
  });
  it('字數與驗證都以整理後的結果為準：含換行的 2 字地址不會被當成 1 字，也不會多算', () => {
    const d = { ...ok, detail: '路\n\n一' };
    expect(addressLength(d)).toBe(3 + 3 + 3);
    expect(validateAddress(d).detail).toBeUndefined();
    expect(validateAddress({ ...ok, detail: '路\n' }).detail).toBe('詳細地址至少 2 個字');
  });
  it('組成訂單地址時也用整理後的詳細地址', () => {
    expect(composeAddress({ zip: '106', city: '臺北市', district: '大安區', detail: '忠孝東路\n四段1號' })).toBe('106 臺北市大安區忠孝東路 四段1號');
  });
});
