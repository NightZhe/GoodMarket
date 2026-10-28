import { describe, expect, it } from 'vitest';
import { labelsFit } from './labelFit';

describe('labelsFit：標籤放不下就整排改純圖示（C4：文字放大到無障礙級距時不放大標籤）', () => {
  it('四個字（11pt 約 44）放得進 60 寬的格子', () => {
    expect(labelsFit([22, 22, 22, 44, 33], 60)).toBe(true);
  });

  it('只要有一個標籤超過可用寬度，整排都不顯示標籤（不能有的有、有的沒有）', () => {
    expect(labelsFit([22, 22, 22, 88, 33], 60)).toBe(false);
  });

  it('剛好等於可用寬度算放得下', () => {
    expect(labelsFit([60], 60)).toBe(true);
  });

  it('量不到寬度（還沒掛上畫面）時視為放得下，不要一開始就藏掉標籤', () => {
    expect(labelsFit([], 60)).toBe(true);
  });
});
