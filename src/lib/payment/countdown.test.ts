import { describe, expect, it } from 'vitest';
import { clockText, isPastDeadline, msUntil } from './countdown';

describe('msUntil：離逾時還有多久', () => {
  const expires = '2026-10-19T08:30:00Z';
  it('還沒到：回正的毫秒數', () => {
    expect(msUntil(expires, Date.parse('2026-10-19T08:00:00Z'))).toBe(30 * 60_000);
  });
  it('剛好到、已經過：一律是 0，不會是負的', () => {
    expect(msUntil(expires, Date.parse(expires))).toBe(0);
    expect(msUntil(expires, Date.parse('2026-10-19T09:00:00Z'))).toBe(0);
  });
  it('時間字串壞掉：當作已經到期，讓畫面去重讀伺服器，不會永遠等', () => {
    expect(msUntil('not-a-date', 0)).toBe(0);
    expect(msUntil(null, 0)).toBe(0);
  });
});

describe('isPastDeadline', () => {
  it('到期那一刻起算逾時', () => {
    const t = Date.parse('2026-10-19T08:30:00Z');
    expect(isPastDeadline('2026-10-19T08:30:00Z', t - 1)).toBe(false);
    expect(isPastDeadline('2026-10-19T08:30:00Z', t)).toBe(true);
  });
});

describe('clockText：「請在 14:32 前付款」用的靜態時間（本機時區 HH:mm）', () => {
  it('兩位數補零', () => {
    const d = new Date(2026, 9, 19, 9, 5);
    expect(clockText(d.toISOString())).toBe('09:05');
    expect(clockText(new Date(2026, 9, 19, 14, 32).toISOString())).toBe('14:32');
  });
  it('壞資料回空字串，由畫面省略那句', () => {
    expect(clockText('x')).toBe('');
    expect(clockText(null)).toBe('');
  });
});
