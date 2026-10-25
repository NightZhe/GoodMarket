import { describe, expect, it } from 'vitest';
import { validateEmail, validatePassword, validateReviewLogin } from './validate';

describe('validateEmail', () => {
  it.each([
    ['review@example.com', 'ok'],
    ['  review@example.com ', 'ok'],
    ['a.b+c@sub.example.co', 'ok'],
    ['', 'invalid'],
    ['   ', 'invalid'],
    ['review', 'invalid'],
    ['review@', 'invalid'],
    ['@example.com', 'invalid'],
    ['review@example', 'invalid'],
    ['re view@example.com', 'invalid'],
    ['a@@example.com', 'invalid'],
  ])('%j -> %s', (input, expected) => {
    expect(validateEmail(input)).toBe(expected);
  });
});

describe('validatePassword', () => {
  it('空字串與全空白都算空白', () => {
    expect(validatePassword('')).toBe('empty');
    expect(validatePassword('   ')).toBe('empty');
  });
  it('有內容就過，不修剪（密碼前後的空白是密碼的一部分）', () => {
    expect(validatePassword('x')).toBe('ok');
    expect(validatePassword(' a b ')).toBe('ok');
  });
});

describe('validateReviewLogin', () => {
  it('兩個都對：回傳修剪後的 email 與原樣密碼', () => {
    expect(validateReviewLogin(' me@example.com ', ' pw ')).toEqual({ ok: true, email: 'me@example.com', password: ' pw ' });
  });
  it('兩個都錯：兩個欄位的錯誤都回，第一個錯誤是 email', () => {
    expect(validateReviewLogin('', '')).toEqual({ ok: false, email: 'invalid', password: 'empty', first: 'email' });
  });
  it('只有密碼錯：first 是 password', () => {
    expect(validateReviewLogin('me@example.com', '')).toEqual({ ok: false, email: 'ok', password: 'empty', first: 'password' });
  });
});
