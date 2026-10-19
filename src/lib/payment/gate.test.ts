import { describe, expect, it } from 'vitest';
import { paymentGate } from './gate';

describe('paymentGate：付款相關頁面要不要放行', () => {
  it('開關還沒有答案：先等，不放行也不導走', () => {
    expect(paymentGate({ enabled: false, ready: false })).toBe('wait');
  });
  it('開關關著：導回（直接輸入網址也進不去）', () => {
    expect(paymentGate({ enabled: false, ready: true })).toBe('redirect');
  });
  it('開關打開：放行', () => {
    expect(paymentGate({ enabled: true, ready: true })).toBe('allow');
  });
  it('讀不到開關（ready 但 enabled 為 false）等同關著', () => {
    expect(paymentGate({ enabled: false, ready: true })).toBe('redirect');
  });
});
