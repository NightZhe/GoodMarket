import { describe, expect, it } from 'vitest';
import { isTwoColumn } from './productColumns';

describe('isTwoColumn：商品頁什麼時候分兩欄（Q3：內容寬 ≥ 720 且視窗寬 > 高）', () => {
  it('內螢幕橫向：視窗 951×669、扣掉右側軌 84 後內容寬 867 → 兩欄', () => {
    expect(isTwoColumn(867, { width: 951, height: 669 })).toBe(true);
  });

  it('內螢幕直向：內容寬夠（669）但不是橫向 → 單欄', () => {
    expect(isTwoColumn(669, { width: 669, height: 951 })).toBe(false);
  });

  it('外螢幕橫向：內容寬 594 不到 720 → 單欄', () => {
    expect(isTwoColumn(594, { width: 678, height: 466 })).toBe(false);
  });

  it('剛好 720 算兩欄、719 不算', () => {
    expect(isTwoColumn(720, { width: 804, height: 600 })).toBe(true);
    expect(isTwoColumn(719, { width: 803, height: 600 })).toBe(false);
  });

  it('視窗正方形（寬等於高）不是橫向 → 單欄', () => {
    expect(isTwoColumn(800, { width: 800, height: 800 })).toBe(false);
  });
});
