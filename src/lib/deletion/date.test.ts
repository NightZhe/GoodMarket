import { describe, expect, it } from 'vitest';
import { requestedYmd, slashDate, spokenDate } from './date';

describe('刪除申請的日期顯示', () => {
  it('YYYY-MM-DD → YYYY/MM/DD', () => {
    expect(slashDate('2026-11-04')).toBe('2026/11/04');
    expect(slashDate('2026-12-31')).toBe('2026/12/31');
  });
  it('口語版去掉前導 0，給讀屏念', () => {
    expect(spokenDate('2026-11-04')).toBe('2026 年 11 月 4 日');
    expect(spokenDate('2026-12-10')).toBe('2026 年 12 月 10 日');
  });
  it('格式不對、月日超出範圍都回空字串（畫面不顯示，不顯示壞字）', () => {
    for (const bad of ['', '2026/11/04', '2026-1-4', '2026-13-01', '2026-00-10', '2026-11-00', '2026-11-32', 'abc', '2026-11-04T00:00:00Z']) {
      expect(slashDate(bad), bad).toBe('');
      expect(spokenDate(bad), bad).toBe('');
    }
  });
  it('申請日取台北日期：UTC 16:00 以後已是台北隔天', () => {
    expect(requestedYmd('2026-10-25T11:36:08.793527+00:00')).toBe('2026-10-25');
    expect(requestedYmd('2026-10-25T15:59:59+00:00')).toBe('2026-10-25');
    expect(requestedYmd('2026-10-25T16:00:00+00:00')).toBe('2026-10-26');
  });
  it('時間字串無法解析回空字串', () => {
    expect(requestedYmd('not a date')).toBe('');
  });
});
