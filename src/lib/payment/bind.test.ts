import { describe, expect, it } from 'vitest';
import { BIND_POLL, bindKindOfStatus, parseBindReturn, bindSessionOf, BIND_SESSION_KEY, taiwanTimeMs } from './bind';

describe('bindKindOfStatus：payment-bind-status／confirm 的結果 → 結果頁種類', () => {
  it('綁好了、重複的卡', () => {
    expect(bindKindOfStatus({ ok: true, status: 'bound', paymentMethodId: 'p', duplicate: false })).toBe('success');
    expect(bindKindOfStatus({ ok: true, status: 'bound', paymentMethodId: 'p', duplicate: true })).toBe('duplicate');
  });
  it('還在確認（created／confirming）：繼續輪詢', () => {
    expect(bindKindOfStatus({ ok: true, status: 'created' })).toBe('pending');
    expect(bindKindOfStatus({ ok: true, status: 'confirming' })).toBe('pending');
  });
  it('失敗：BIND_NOT_FOUND 是查不到（結果不明），其他是銀行未通過', () => {
    expect(bindKindOfStatus({ ok: true, status: 'failed', code: 'BIND_FAILED', message: 'x' })).toBe('declined');
    expect(bindKindOfStatus({ ok: true, status: 'failed', code: 'BIND_NOT_FOUND', message: 'x' })).toBe('unknown');
  });
});

describe('輪詢參數', () => {
  it('每 2 秒一次、最多 60 秒', () => {
    expect(BIND_POLL).toEqual({ intervalMs: 2_000, maxMs: 60_000 });
  });
});

describe('parseBindReturn：3D 回來的 ?bind=…&no=…（網址可被亂改，只用來決定查哪一筆）', () => {
  it('合法', () => {
    expect(parseBindReturn(new URLSearchParams('bind=bound&no=GM123abc'))).toEqual({ hint: 'bound', no: 'GM123abc' });
    expect(parseBindReturn(new URLSearchParams('bind=confirming&no=x1'))).toEqual({ hint: 'confirming', no: 'x1' });
  });
  it('沒有編號、或 bind 不是三個值之一：null', () => {
    expect(parseBindReturn(new URLSearchParams('bind=bound'))).toBeNull();
    expect(parseBindReturn(new URLSearchParams('bind=hacked&no=x'))).toBeNull();
    expect(parseBindReturn(new URLSearchParams(''))).toBeNull();
  });
  it('編號含奇怪字元或過長：null（不拿去查）', () => {
    expect(parseBindReturn(new URLSearchParams('bind=bound&no=<script>'))).toBeNull();
    expect(parseBindReturn(new URLSearchParams(`bind=bound&no=${'a'.repeat(65)}`))).toBeNull();
  });
});

describe('bindSessionOf：跳 3D 前記下的來源', () => {
  it('壞資料回 null；編號對得上才採用', () => {
    expect(bindSessionOf(null, 'n1')).toBeNull();
    expect(bindSessionOf('{bad', 'n1')).toBeNull();
    expect(bindSessionOf(JSON.stringify({ no: 'n2', from: 'checkout' }), 'n1')).toBeNull();
    expect(bindSessionOf(JSON.stringify({ no: 'n1', from: 'checkout' }), 'n1')).toEqual({ no: 'n1', from: 'checkout' });
    expect(bindSessionOf(JSON.stringify({ no: 'n1', from: 'weird' }), 'n1')).toEqual({ no: 'n1', from: 'page' });
  });
  it('鍵名固定', () => expect(BIND_SESSION_KEY).toBe('goodmarket_bind_session'));
});

describe('taiwanTimeMs：綠界給的 yyyy/MM/dd HH:mm:ss 是台灣時間', () => {
  it('換算成毫秒時間戳（UTC+8）', () => {
    expect(taiwanTimeMs('2026/10/19 16:30:00')).toBe(Date.parse('2026-10-19T08:30:00Z'));
  });
  it('格式不對回 NaN，呼叫端當作「已失效」', () => {
    expect(taiwanTimeMs('soon')).toBeNaN();
    expect(taiwanTimeMs('')).toBeNaN();
  });
});
