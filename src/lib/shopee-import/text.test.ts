import { describe, expect, it } from 'vitest';
import { codePointLength, normalizeDescription, parseNonNegativeInt } from './text';
import { mapShopeeCategory, parseShopeeCategoryId } from './categories';

describe('text', () => {
  it('字數以 code point 計，不是 UTF-16', () => {
    expect(codePointLength('😀a')).toBe(2);
    expect('😀a'.length).toBe(3);
    expect(codePointLength('🏎️')).toBe(2); // 🏎 + 變體選擇符，與 Postgres char_length 一致
  });

  it('描述：CRLF 正規化、去頭尾空白、內部換行保留', () => {
    expect(normalizeDescription('\n a\r\n\r\nb \r\n')).toBe('a\n\nb');
  });

  it('只接受非負整數字串', () => {
    expect(parseNonNegativeInt('1500')).toBe(1500);
    expect(parseNonNegativeInt('0')).toBe(0);
    for (const bad of ['', '1.5', '1,500', '-1', 'abc', '1e3', ' 1']) expect(parseNonNegativeInt(bad)).toBeNull();
  });
});

describe('categories', () => {
  it('取「 - 」前的數字 ID 查表', () => {
    expect(parseShopeeCategoryId('101087 - Gaming & Consoles/Video Games/Switch')).toBe('101087');
    expect(mapShopeeCategory('101087 - Gaming & Consoles/Video Games/Switch')).toBe('games');
    expect(mapShopeeCategory('101388 - x')).toBe('toys');
    expect(mapShopeeCategory('101241 - x')).toBe('home');
  });

  it('表外、空白、不是數字都歸「其他」', () => {
    expect(mapShopeeCategory('999999 - Test/Unknown')).toBe('other');
    expect(mapShopeeCategory('')).toBe('other');
    expect(mapShopeeCategory('constructor - x')).toBe('other');
    expect(mapShopeeCategory('100766 - Tickets')).toBe('other');
  });
});
