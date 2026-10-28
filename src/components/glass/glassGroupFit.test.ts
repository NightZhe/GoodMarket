import { describe, expect, it } from 'vitest';
import { groupWidth, shouldCollapse } from './glassGroupFit';

describe('groupWidth：水平玻璃膠囊群組的寬度', () => {
  it('四格＋一條分隔槽＝178（設計稿）', () => {
    expect(groupWidth(4, 1)).toBe(178);
  });
  it('沒有分隔就是格數 × 44', () => {
    expect(groupWidth(3, 0)).toBe(132);
  });
});

describe('shouldCollapse：放不下才收成「⋯」（C1＝a，量實際寬度、不看機型）', () => {
  it('390、375、320 寬（左鈕 78）都放得下：不收', () => {
    // 可用寬 = 視窗 − 邊距 32 − 左鈕 78 − 間距 8
    expect(shouldCollapse(390 - 32 - 78 - 8, 178)).toBe(false);
    expect(shouldCollapse(375 - 32 - 78 - 8, 178)).toBe(false);
    expect(shouldCollapse(320 - 32 - 78 - 8, 178)).toBe(false);
  });
  it('188 寬（375 加頁面縮放 200%）與「320 寬加文字 200%」放不下：收', () => {
    expect(shouldCollapse(188 - 32 - 78 - 8, 178)).toBe(true);
    expect(shouldCollapse(320 - 32 - 112 - 8, 178)).toBe(true);
  });
  it('剛好等於群組寬不收；少 1 就收', () => {
    expect(shouldCollapse(178, 178)).toBe(false);
    expect(shouldCollapse(177, 178)).toBe(true);
  });
  it('還沒量到（Infinity）先當放得下，免得第一幀閃一下「⋯」', () => {
    expect(shouldCollapse(Number.POSITIVE_INFINITY, 178)).toBe(false);
  });
  it('強制收合（forceCollapse）一律收', () => {
    expect(shouldCollapse(1000, 178, true)).toBe(true);
  });
});
