import { describe, expect, it } from 'vitest';
import { PLATFORM_COLLECT_REVISION, PLATFORM_COLLECT_USE_SENTENCE, privacyEffectiveDate, taipeiDate } from './platformCollect';

// PR-乙 IN-B8／AC-58：隱私政策的句子與日期跟平台收款開關走（design.md §3）
describe('taipeiDate：ISO 時間 → 台灣日期 YYYY/MM/DD', () => {
  it('UTC 16:00 之後已是台灣隔天', () => {
    expect(taipeiDate('2026-10-31T15:59:00+00:00')).toBe('2026/10/31');
    expect(taipeiDate('2026-10-31T16:00:00Z')).toBe('2026/11/01');
  });
  it('null、空字串、壞字串 → null', () => {
    expect(taipeiDate(null)).toBeNull();
    expect(taipeiDate('')).toBeNull();
    expect(taipeiDate('not a date')).toBeNull();
  });
});

describe('privacyEffectiveDate：生效日取較晚者', () => {
  it('打開日晚於常數 → 打開日；同一天 → 同一天；早於 → 常數；null → 常數', () => {
    expect(privacyEffectiveDate('2026/10/29', '2026/11/02')).toBe('2026/11/02');
    expect(privacyEffectiveDate('2026/10/29', '2026/10/29')).toBe('2026/10/29');
    expect(privacyEffectiveDate('2026/10/29', '2026/10/20')).toBe('2026/10/29');
    expect(privacyEffectiveDate('2026/10/29', null)).toBe('2026/10/29');
  });
});

describe('文案（待律師定稿；不含撥款時程、特約商店、開通）', () => {
  it('第 2 節句子＝甲 spec §7.2 原句', () => {
    expect(PLATFORM_COLLECT_USE_SENTENCE).toBe('你按下付款時，向綠界科技請求用你選的卡付款；款項先付給好物集，由好物集撥給賣家。');
  });
  it('修訂紀錄句＝design.md §3.4', () => {
    expect(PLATFORM_COLLECT_REVISION).toBe('線上付款改由好物集代收：你付的款項先付給好物集，再由好物集撥給賣家。');
  });
  it('兩句都不提撥款時程、特約商店、開通', () => {
    for (const s of [PLATFORM_COLLECT_USE_SENTENCE, PLATFORM_COLLECT_REVISION]) expect(s).not.toMatch(/\d+\s*天|工作天|特約商店|開通/);
  });
});
