import { describe, expect, it } from 'vitest';
import type { AddressRow } from './addresses';
import { addressFromRow, addressFromDraft, buyerOf, pickBookAddress } from './checkoutAddress';

const row = (over: Partial<AddressRow> = {}): AddressRow => ({
  id: 'a-1', user_id: 'u', recipient: '王小明', phone: '0912345678', city: '臺北市', district: '大安區',
  postal_code: '106', detail: '忠孝東路四段1號5樓', is_default: false, created_at: '', updated_at: '', ...over,
});
const home = row({ id: 'home', is_default: true });
const office = row({ id: 'office', recipient: '李小華', phone: '0922333444', city: '桃園市', district: '中壢區', postal_code: '320', detail: '中正路1號' });

describe('結帳預設帶入哪一筆（AC-A20）', () => {
  it('沒換過：帶預設那筆，不管它排在第幾', () => {
    const got = pickBookAddress([office, home], null, null)!;
    expect(got.bookId).toBe('home');
    expect(got).toMatchObject({ source: 'book', name: '王小明', phone: '0912345678', zip: '106', city: '臺北市', district: '大安區', saveToBook: false });
  });
  it('換過：帶選的那一筆', () => {
    expect(pickBookAddress([home, office], 'office', null)!.bookId).toBe('office');
  });
  it('沒有標示預設的資料（不該發生）退回第一筆', () => {
    expect(pickBookAddress([office], null, null)!.bookId).toBe('office');
  });
  it('地址簿還沒讀到、也沒有快照：沒有答案', () => {
    expect(pickBookAddress(null, null, null)).toBeNull();
    expect(pickBookAddress([], null, null)).toBeNull();
  });
});

describe('登入過期後還原（AC-A25）：靠快照，不靠地址編號', () => {
  const frozen = addressFromRow(office);
  it('選的那一筆事後被刪了：仍顯示快照，不退回預設', () => {
    expect(pickBookAddress([home], 'office', frozen)).toEqual(frozen);
  });
  it('地址簿整個被清空或還沒讀回來：仍顯示快照', () => {
    expect(pickBookAddress([], 'office', frozen)).toEqual(frozen);
    expect(pickBookAddress(null, 'office', frozen)).toEqual(frozen);
  });
  it('那一筆還在：以地址簿現在的內容為準（可能剛在抽屜裡改過）', () => {
    const edited = row({ ...office, detail: '中正路99號' });
    expect(pickBookAddress([home, edited], 'office', frozen)!.detail).toBe('中正路99號');
  });
  it('使用者還原後又在抽屜換了別筆：以新選的為準', () => {
    expect(pickBookAddress([home, office], 'home', frozen)!.bookId).toBe('home');
  });
});

describe('手動表單 → 快照', () => {
  const draft = { recipient: ' 王小明 ', phone: '0912-345-678', city: '臺北市', district: '大安區', detail: ' 忠孝東路四段1號5樓 ' };
  it('郵遞區號由縣市＋區帶出；去前後空白；記住「存到我的地址」', () => {
    expect(addressFromDraft(draft, true)).toEqual({
      source: 'manual', bookId: null, name: '王小明', phone: '0912-345-678', zip: '106',
      city: '臺北市', district: '大安區', detail: '忠孝東路四段1號5樓', saveToBook: true,
    });
  });
  it('詳細地址的換行與連續空白整理成單一空白', () => {
    expect(addressFromDraft({ ...draft, detail: '忠孝東路\n  四段1號' }, false).detail).toBe('忠孝東路 四段1號');
  });
  it('還沒選區：郵遞區號是空字串（待辦動作要能存下填到一半的表單）', () => {
    expect(addressFromDraft({ ...draft, district: '' }, false).zip).toBe('');
  });
});

describe('寫進訂單的收件資料（R-A19、AC-A35）', () => {
  it('地址是「郵遞區號 縣市區詳細地址」，手機統一成 0912-345-678', () => {
    expect(buyerOf(addressFromRow(home))).toEqual({ name: '王小明', phone: '0912-345-678', address: '106 臺北市大安區忠孝東路四段1號5樓' });
  });
  it('手動表單下的單也是同一個格式；連字號寫法不同也統一', () => {
    const m = addressFromDraft({ recipient: '甲', phone: '0912345678', city: '桃園市', district: '中壢區', detail: '中正路1號' }, false);
    expect(buyerOf(m)).toEqual({ name: '甲', phone: '0912-345-678', address: '320 桃園市中壢區中正路1號' });
  });
});
