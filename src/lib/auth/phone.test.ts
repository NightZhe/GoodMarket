import { describe, expect, it } from 'vitest';
import {
  CODE_LENGTH, formatTwPhone, maskTwPhone, maskTwPhoneSpoken, nationalFromAuthPhone, normalizeCode, normalizeTwPhone,
} from './phone';

describe('門號整理（R-2、AC-1）', () => {
  const E164 = '+886912345678';
  it.each([
    '0912345678', '0912-345-678', '0912 345 678', '+886 912 345 678', '+886912345678', '886912345678',
    '+886 0912345678', '912345678', '０９１２３４５６７８', '(0912)345-678', '０９１２－３４５－６７８', '0912‐345‐678', '  0912345678  ',
  ])('%s → +886912345678', raw => {
    expect(normalizeTwPhone(raw)).toEqual({ ok: true, e164: E164, national: '0912345678' });
  });

  it('空白 → empty', () => {
    expect(normalizeTwPhone('')).toEqual({ ok: false, reason: 'empty' });
    expect(normalizeTwPhone('   ')).toEqual({ ok: false, reason: 'empty' });
  });

  it.each(['0812345678', '091234567', '09123456789', '0912a45678', 'abcdefghij', '88612345678', '0212345678'])('格式不對 %s → format', raw => {
    expect(normalizeTwPhone(raw)).toEqual({ ok: false, reason: 'format' });
  });

  it.each(['+85291234567', '+14155550100', '+81 90-1234-5678'])('非台灣國碼 %s → foreign', raw => {
    expect(normalizeTwPhone(raw)).toEqual({ ok: false, reason: 'foreign' });
  });

  it('+886 但不是 9 開頭行動門號 → format（不是 foreign）', () => {
    expect(normalizeTwPhone('+88622345678')).toEqual({ ok: false, reason: 'format' });
  });
});

describe('門號顯示（R-26、AC-4）', () => {
  it('回顯 0912-345-678、遮罩 0912-***-678', () => {
    expect(formatTwPhone('0912345678')).toBe('0912-345-678');
    expect(maskTwPhone('0912345678')).toBe('0912-***-678');
  });
  it('讀屏念法不念星號', () => {
    expect(maskTwPhoneSpoken('0912345678')).toBe('0912，中間三碼已隱藏，尾數 678');
  });
  it('auth.users.phone（不含 +）轉成 09 開頭', () => {
    expect(nationalFromAuthPhone('886912345678')).toBe('0912345678');
    expect(nationalFromAuthPhone('+886912345678')).toBe('0912345678');
  });
  it('不是台灣行動門號、空字串、null → null', () => {
    expect(nationalFromAuthPhone('')).toBeNull();
    expect(nationalFromAuthPhone(null)).toBeNull();
    expect(nationalFromAuthPhone(undefined)).toBeNull();
    expect(nationalFromAuthPhone('85291234567')).toBeNull();
  });
});

describe('驗證碼整理（R-20、AC-13）', () => {
  it('位數是常數 6', () => expect(CODE_LENGTH).toBe(6));
  it.each(['123 456', '123-456', '１２３４５６', ' 123456 ', '123456'])('%s → 123456', raw => {
    expect(normalizeCode(raw)).toEqual({ ok: true, code: '123456' });
  });
  it('保留開頭的 0', () => expect(normalizeCode('012 345')).toEqual({ ok: true, code: '012345' }));
  it('空白 → empty', () => {
    expect(normalizeCode('')).toEqual({ ok: false, reason: 'empty' });
    expect(normalizeCode(' - ')).toEqual({ ok: false, reason: 'empty' });
  });
  it.each(['12345', '1234567', '12a456'])('%s → format', raw => {
    expect(normalizeCode(raw)).toEqual({ ok: false, reason: 'format' });
  });
});
