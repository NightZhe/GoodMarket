import { describe, expect, it } from 'vitest';
import { clampPage, pageItems, parsePage, parseSize, totalPagesOf } from './Pagination';

describe('parseSize', () => {
  it('合法值原樣回傳', () => {
    expect([20, 50, 100].map(n => parseSize(String(n)))).toEqual([20, 50, 100]);
  });
  it('不合法時取最接近的合法值或預設', () => {
    expect(parseSize('7')).toBe(20);
    expect(parseSize('60')).toBe(50);
    expect(parseSize('9999')).toBe(100);
    expect(parseSize('-5')).toBe(20);
    expect(parseSize('abc')).toBe(20);
    expect(parseSize('')).toBe(20);
    expect(parseSize(null)).toBe(20);
  });
});

describe('parsePage', () => {
  it('負數、0、非數字、空值都當第 1 頁', () => {
    for (const raw of ['-1', '0', 'abc', '', null, 'NaN', 'Infinity']) expect(parsePage(raw)).toBe(1);
  });
  it('小數無條件捨去，大數保留給 clampPage', () => {
    expect(parsePage('3')).toBe(3);
    expect(parsePage('2.9')).toBe(2);
    expect(parsePage('999')).toBe(999);
  });
});

describe('clampPage / totalPagesOf', () => {
  it('頁碼限制在 1..總頁數', () => {
    expect(clampPage(999, 17)).toBe(17);
    expect(clampPage(0, 17)).toBe(1);
    expect(clampPage(5, 17)).toBe(5);
  });
  it('總頁數至少 1，340 件在三種每頁筆數下為 17／7／4', () => {
    expect(totalPagesOf(0, 20)).toBe(1);
    expect([20, 50, 100].map(s => totalPagesOf(340, s))).toEqual([17, 7, 4]);
    expect(totalPagesOf(340, 20)).toBe(17);
    expect(totalPagesOf(20, 20)).toBe(1);
    expect(totalPagesOf(21, 20)).toBe(2);
  });
});

describe('pageItems', () => {
  it('第 1 頁：1 2 … 17', () => {
    expect(pageItems(1, 17)).toEqual([1, 2, 'gap', 17]);
  });
  it('第 9 頁：1 … 8 9 10 … 17', () => {
    expect(pageItems(9, 17)).toEqual([1, 'gap', 8, 9, 10, 'gap', 17]);
  });
  it('第 17 頁：1 … 16 17', () => {
    expect(pageItems(17, 17)).toEqual([1, 'gap', 16, 17]);
  });
  it('缺口只有 1 頁時直接顯示該頁', () => {
    expect(pageItems(4, 17)).toEqual([1, 2, 3, 4, 5, 'gap', 17]);
    expect(pageItems(14, 17)).toEqual([1, 'gap', 13, 14, 15, 16, 17]);
  });
  it('頁數少時全部列出', () => {
    expect(pageItems(1, 1)).toEqual([1]);
    expect(pageItems(2, 4)).toEqual([1, 2, 3, 4]);
  });
});
