import { describe, expect, it } from 'vitest';
import { addDays, dailyWindow, MAX_RANGE_DAYS, splitRange, twToday } from './payoutDates.ts';

const days = (from: string, to: string) => (Date.parse(to) - Date.parse(from)) / 86400_000 + 1;

describe('splitRange：一次呼叫最多 1 個月（AC-R5）', () => {
  it('45 天 → 2 段，不重疊、接起來剛好 45 天、每段 ≤ 上限', () => {
    const segs = splitRange('2026-11-01', '2026-12-15');
    expect(segs).toHaveLength(2);
    expect(segs[0].from).toBe('2026-11-01');
    expect(segs[1].to).toBe('2026-12-15');
    expect(addDays(segs[0].to, 1)).toBe(segs[1].from);
    expect(segs.reduce((n, s) => n + days(s.from, s.to), 0)).toBe(45);
    for (const s of segs) expect(days(s.from, s.to)).toBeLessThanOrEqual(MAX_RANGE_DAYS);
  });
  it('剛好上限 → 1 段；1 天 → 1 段；跨年', () => {
    expect(splitRange('2026-10-01', addDays('2026-10-01', MAX_RANGE_DAYS - 1))).toHaveLength(1);
    expect(splitRange('2026-10-20', '2026-10-20')).toEqual([{ from: '2026-10-20', to: '2026-10-20' }]);
    expect(splitRange('2026-12-20', '2027-01-10')).toEqual([{ from: '2026-12-20', to: '2027-01-10' }]);
  });
  it('開始晚於結束、格式不對 → 丟錯（呼叫端的 bug，不默默送綠界）', () => {
    expect(() => splitRange('2026-10-21', '2026-10-20')).toThrow();
    expect(() => splitRange('2026/10/01', '2026-10-20')).toThrow();
    expect(() => splitRange('2026-02-30', '2026-03-01')).toThrow();
  });
});

describe('twToday／dailyWindow：「今天」一律台灣時間', () => {
  it('UTC 15:59 還是台灣當天 23:59；UTC 16:00 已是台灣隔天', () => {
    expect(twToday(Date.UTC(2026, 9, 20, 15, 59))).toBe('2026-10-20');
    expect(twToday(Date.UTC(2026, 9, 20, 16, 0))).toBe('2026-10-21');
  });
  it('每日排程範圍：依結算日，今天往前 14 天到今天（D41＝A）', () => {
    expect(dailyWindow(Date.UTC(2026, 9, 21, 7, 10))).toEqual({ from: '2026-10-07', to: '2026-10-21' });
  });
});
