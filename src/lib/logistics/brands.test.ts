import { describe, expect, it } from 'vitest';
import { BRAND_OPTIONS, brandLabel, isBrandCode } from './brands';

describe('超商品牌：畫面字樣 ↔ 資料庫代碼（interface-logistics.md 第 1 節、決策 N7）', () => {
  it('四個代碼各對到定稿字樣，順序＝下拉順序', () => {
    expect(BRAND_OPTIONS.map(b => [b.code, b.label])).toEqual([
      ['seven_eleven', '7-ELEVEN'],
      ['familymart', '全家'],
      ['hilife', '萊爾富'],
      ['okmart', 'OKmart'],
    ]);
  });
  it('brandLabel：代碼 → 字樣', () => {
    expect(brandLabel('okmart')).toBe('OKmart');
    expect(brandLabel('hilife')).toBe('萊爾富');
  });
  it('資料庫日後多出不認得的代碼：照原樣顯示，不丟錯、不顯示空白', () => {
    expect(brandLabel('new_brand')).toBe('new_brand');
  });
  it('isBrandCode 只認四個代碼，字樣與大小寫不同的都不算（資料庫同樣拒絕）', () => {
    expect(isBrandCode('seven_eleven')).toBe(true);
    for (const bad of ['', '7-ELEVEN', 'Seven_Eleven', ' okmart', 'ok']) expect(isBrandCode(bad), bad).toBe(false);
  });
});
