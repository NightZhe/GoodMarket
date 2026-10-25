import { describe, expect, it } from 'vitest';
import { contrastRatio, relativeLuminance } from './contrast';

const WHITE = '#FFFFFF';
const GROUPED = '#F2F2F7';
const AA_TEXT = 4.5;

describe('relativeLuminance（WCAG 2.x）', () => {
  it('白 = 1、黑 = 0', () => {
    expect(relativeLuminance('#FFFFFF')).toBeCloseTo(1, 5);
    expect(relativeLuminance('#000000')).toBeCloseTo(0, 5);
  });

  it('接受 3 碼縮寫與小寫', () => {
    expect(relativeLuminance('#fff')).toBeCloseTo(1, 5);
  });

  it('不是 6 碼或 3 碼色碼就丟錯', () => {
    expect(() => relativeLuminance('red')).toThrow();
    expect(() => relativeLuminance('#12345')).toThrow();
  });
});

describe('contrastRatio', () => {
  it('黑對白 = 21、同色 = 1，且與順序無關', () => {
    expect(contrastRatio('#000000', WHITE)).toBeCloseTo(21, 2);
    expect(contrastRatio(WHITE, '#000000')).toBeCloseTo(21, 2);
    expect(contrastRatio('#BF4419', '#BF4419')).toBeCloseTo(1, 5);
  });
});

describe('品牌色對比（design-final.md §2.1，D2）', () => {
  it('主色 #BF4419 在白底 ≥ 4.5（5.18）', () => {
    const r = contrastRatio('#BF4419', WHITE);
    expect(r).toBeGreaterThanOrEqual(AA_TEXT);
    expect(r).toBeCloseTo(5.18, 1);
  });

  it('主色 #BF4419 在灰膠囊 #F2F2F7 ≥ 4.5（4.64）', () => {
    const r = contrastRatio('#BF4419', GROUPED);
    expect(r).toBeGreaterThanOrEqual(AA_TEXT);
    expect(r).toBeCloseTo(4.64, 1);
  });

  it('白字在按下色 #A33A15 ≥ 4.5（6.62）', () => {
    const r = contrastRatio(WHITE, '#A33A15');
    expect(r).toBeGreaterThanOrEqual(AA_TEXT);
    expect(r).toBeCloseTo(6.62, 1);
  });

  it('次要文字 #6C6C70 在白底 ≥ 4.5（5.23）', () => {
    const r = contrastRatio('#6C6C70', WHITE);
    expect(r).toBeGreaterThanOrEqual(AA_TEXT);
    expect(r).toBeCloseTo(5.23, 1);
  });

  it('徽章紅 #D70015 底、白字 ≥ 4.5（5.38）', () => {
    const r = contrastRatio(WHITE, '#D70015');
    expect(r).toBeGreaterThanOrEqual(AA_TEXT);
    expect(r).toBeCloseTo(5.38, 1);
  });

  it('logo 橘 #F2582A 在白底 < 4.5（3.38）：只能當圖形，不能當文字色', () => {
    const r = contrastRatio('#F2582A', WHITE);
    expect(r).toBeLessThan(AA_TEXT);
    expect(r).toBeGreaterThanOrEqual(3);
    expect(r).toBeCloseTo(3.38, 1);
  });
});
