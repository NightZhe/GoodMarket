import { describe, expect, it } from 'vitest';
import { amrOfToken, otpIsFresh } from './stepUp';

const token = (payload: unknown) => `h.${btoa(JSON.stringify(payload)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')}.s`;
const NOW = 1_800_000_000_000;
const sec = (ms: number) => Math.floor(ms / 1000);

describe('amrOfToken', () => {
  it('讀出 amr；壞 token、壞形狀回空陣列', () => {
    expect(amrOfToken(token({ amr: [{ method: 'otp', timestamp: 5 }] }))).toEqual([{ method: 'otp', timestamp: 5 }]);
    for (const bad of [null, undefined, '', 'x', 'a.b.c', token({}), token({ amr: 'otp' }), token({ amr: [{ method: 'otp' }] })]) expect(amrOfToken(bad as string)).toEqual([]);
  });
});

describe('otpIsFresh：10 分鐘內有 otp 才算已驗證', () => {
  it('9 分鐘前：新鮮；11 分鐘前：過期', () => {
    expect(otpIsFresh([{ method: 'otp', timestamp: sec(NOW - 9 * 60_000) }], NOW)).toBe(true);
    expect(otpIsFresh([{ method: 'otp', timestamp: sec(NOW - 11 * 60_000) }], NOW)).toBe(false);
  });
  it('取最新一筆 otp；非 otp 不算；沒有 amr 不算', () => {
    expect(otpIsFresh([{ method: 'otp', timestamp: sec(NOW - 60 * 60_000) }, { method: 'otp', timestamp: sec(NOW - 60_000) }], NOW)).toBe(true);
    expect(otpIsFresh([{ method: 'password', timestamp: sec(NOW) }], NOW)).toBe(false);
    expect(otpIsFresh([], NOW)).toBe(false);
  });
  it('晚於現在超過 1 分鐘（時鐘不對）不算', () => {
    expect(otpIsFresh([{ method: 'otp', timestamp: sec(NOW + 30_000) }], NOW)).toBe(true);
    expect(otpIsFresh([{ method: 'otp', timestamp: sec(NOW + 120_000) }], NOW)).toBe(false);
  });
});
