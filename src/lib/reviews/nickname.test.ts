import { describe, expect, it } from 'vitest';
import { maskNickname, normalizeNickname, validateNickname } from './nickname';
import { NICKNAME_VECTORS } from './nickname-vectors';

describe('maskNickname', () => {
  it.each([
    ['harry8', 'h*****8'],
    ['王小明', '王*****明'],
    ['小貓', '小*****'],
    ['abcdefghijkl', 'a*****l'],
  ])('%s → %s', (input, expected) => {
    expect(maskNickname(input)).toBe(expected);
  });

  it('一個字（格式不允許）退回匿名買家', () => {
    expect(maskNickname('a')).toBe('匿名買家');
  });

  it('以 code point 計算，不會把擴充區的字拆成兩半', () => {
    expect(maskNickname('𠮷野家')).toBe('𠮷*****家');
  });
});

describe('validateNickname', () => {
  it('沒填或只有空白：視為沒填', () => {
    expect(validateNickname('')).toEqual({ ok: true, value: null });
    expect(validateNickname('   ')).toEqual({ ok: true, value: null });
    expect(validateNickname('　')).toEqual({ ok: true, value: null });
  });

  it('前後空白會被去掉', () => {
    expect(validateNickname('  小貓 ')).toEqual({ ok: true, value: '小貓' });
    expect(normalizeNickname('　abc　')).toBe('abc');
  });

  it.each(['harry8', '王小明', 'x_y-z', 'abcdefghijkl', 'ab_c-1'])('合法：%s', (nick) => {
    expect(validateNickname(nick)).toMatchObject({ ok: true, value: nick });
  });

  it.each([
    ['1 字', 'a'],
    ['13 字', 'abcdefghijklm'],
    ['中間有空白', '小 貓'],
    ['emoji', '小貓🐱'],
    ['句點', 'a.b'],
    ['驚嘆號', 'hi!'],
    ['email', 'x@y'],
  ])('不合法：%s', (_label, nick) => {
    expect(validateNickname(nick).ok).toBe(false);
  });

  it('12 個 code point 的擴充區字元算 12 字，不是 24', () => {
    expect(validateNickname('𠮷'.repeat(12)).ok).toBe(true);
    expect(validateNickname('𠮷'.repeat(13)).ok).toBe(false);
  });
});

describe('與資料庫共用的測試向量', () => {
  it('向量檔有 87 筆', () => {
    expect(NICKNAME_VECTORS).toHaveLength(87);
  });

  it.each(NICKNAME_VECTORS.map(v => [JSON.stringify(v.input), v] as const))('%s', (_label, v) => {
    const r = validateNickname(v.input);
    expect(r.ok, v.note).toBe(v.valid);
    if (v.valid && r.ok) expect(r.value, v.note).toBe(v.stored ?? null);
  });
});

describe('明確不允許的字元', () => {
  it.each(['Ⅻ1', 'a・b', 'ａｂｃ', '①②', 'かな', '한글', 'éa', 'абв', '½a', '〇a'])('%s', (nick) => {
    expect(validateNickname(nick).ok).toBe(false);
  });
});
