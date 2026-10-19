import { describe, expect, it } from 'vitest';
import { brandLabel, brandOfCard6, cardBrandOf, expiryOf } from './cards';

describe('brandOfCard6：由前六碼推卡別（設計 6.2 的號段）', () => {
  it.each([
    ['431195', 'visa'], ['400000', 'visa'],
    ['510000', 'mastercard'], ['559999', 'mastercard'], ['222100', 'mastercard'], ['272099', 'mastercard'],
    ['352800', 'jcb'], ['358999', 'jcb'],
    ['340000', 'amex'], ['370000', 'amex'],
    ['620000', 'unionpay'],
    ['600000', 'other'], ['560000', 'other'], ['222000', 'other'], ['272100', 'other'], ['352700', 'other'], ['359000', 'other'], ['', 'other'],
  ])('%s → %s', (card6, brand) => {
    expect(brandOfCard6(card6)).toBe(brand);
  });
});

describe('cardBrandOf：以資料庫 view 的 brand 為準，只有 other 才自己推', () => {
  it('view 已經有卡別就直接用', () => {
    expect(cardBrandOf({ brand: 'jcb', card6: '400000' })).toBe('jcb');
  });
  it('view 回 other 時用前六碼補推；推不出來仍是 other', () => {
    expect(cardBrandOf({ brand: 'other', card6: '358000' })).toBe('jcb');
    expect(cardBrandOf({ brand: 'other', card6: '999999' })).toBe('other');
  });
});

describe('brandLabel', () => {
  it('每個卡別都有文字，推不出來寫「信用卡」', () => {
    expect(brandLabel('visa')).toBe('Visa');
    expect(brandLabel('mastercard')).toBe('Mastercard');
    expect(brandLabel('jcb')).toBe('JCB');
    expect(brandLabel('amex')).toBe('AMEX');
    expect(brandLabel('unionpay')).toBe('銀聯');
    expect(brandLabel('other')).toBe('信用卡');
  });
});

describe('expiryOf：有效到該月最後一天，之後（台北時間）算過期', () => {
  const at = (iso: string) => new Date(iso);
  it('有效期限所在月份的最後一刻仍有效', () => {
    // 台北 2027/11/30 23:59 ＝ UTC 15:59
    expect(expiryOf('27', '11', at('2027-11-30T15:59:00Z'))).toEqual({ text: '11/27', expired: false });
  });
  it('台北時間進入下個月的第一刻就過期（UTC 還在上個月最後一天）', () => {
    expect(expiryOf('27', '11', at('2027-11-30T16:00:00Z')).expired).toBe(true);
  });
  it('過去的年月過期，未來的不過期', () => {
    expect(expiryOf('25', '08', at('2026-10-19T00:00:00Z'))).toEqual({ text: '08/25', expired: true });
    expect(expiryOf('28', '03', at('2026-10-19T00:00:00Z'))).toEqual({ text: '03/28', expired: false });
  });
  it('跨年：12 月到期的卡在隔年 1 月 1 日（台北）過期', () => {
    expect(expiryOf('26', '12', at('2026-12-31T15:59:59Z')).expired).toBe(false);
    expect(expiryOf('26', '12', at('2026-12-31T16:00:00Z')).expired).toBe(true);
  });
});
