import { describe, expect, it } from 'vitest';
import { avgStarsLabel, deadlineLabel, starsLabel, taipeiDate, taipeiDateTime } from './format';

describe('台北時間格式', () => {
  it('UTC 16:30 已經是台北隔天 00:30', () => {
    expect(taipeiDate('2026-10-01T16:30:00Z')).toBe('2026-10-02');
    expect(taipeiDateTime('2026-10-01T16:30:00Z')).toBe('2026-10-02 00:30');
  });

  it('午夜不會顯示成 24:00', () => {
    expect(taipeiDateTime('2026-10-01T16:00:00Z')).toBe('2026-10-02 00:00');
  });

  it('台北 23:59:59 還是當天', () => {
    expect(taipeiDateTime('2026-10-31T15:59:59Z')).toBe('2026-10-31 23:59');
  });

  it('無法解析的時間回空字串', () => {
    expect(taipeiDate('not a date')).toBe('');
  });
});

describe('期限與星等文字', () => {
  it('期限文字固定寫 23:59', () => {
    expect(deadlineLabel('2026-10-31')).toBe('評價期限：2026-10-31 23:59');
  });

  it('星等替代文字', () => {
    expect(avgStarsLabel(4.8, 6)).toBe('評分 4.8，滿分 5 分，共 6 則評價');
    expect(avgStarsLabel(4, 1)).toBe('評分 4.0，滿分 5 分，共 1 則評價');
    expect(starsLabel(3)).toBe('評分 3，滿分 5 分');
  });
});
