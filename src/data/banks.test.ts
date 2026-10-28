import { describe, expect, it } from 'vitest';
import banks from './banks.json';
import branches from './bank-branches.json';
import districts from './tw-districts.json';

describe('banks.json（契約 v2.1 §6.1）', () => {
  it('63 間、依代碼排序、欄位集合固定、代碼 3 碼不重複', () => {
    expect(banks).toHaveLength(63);
    expect(banks.map((b) => b.code)).toEqual([...banks.map((b) => b.code)].sort());
    expect(new Set(banks.map((b) => b.code)).size).toBe(63);
    for (const b of banks) expect(Object.keys(b)).toEqual(['code', 'name', 'short', 'common']);
    for (const b of banks) expect(b.code).toMatch(/^[0-9]{3}$/);
  });
  it('常用 6 家：順序 1～6 與 N8 一致，short 只有常用銀行有', () => {
    const common = banks.filter((b) => b.common !== null).sort((a, b) => a.common! - b.common!);
    expect(common.map((b) => [b.common, b.code, b.short])).toEqual([
      [1, '822', '中國信託'], [2, '013', '國泰世華'], [3, '808', '玉山'], [4, '012', '台北富邦'], [5, '700', '中華郵政'], [6, '017', '兆豐'],
    ]);
    expect(banks.filter((b) => b.short !== null)).toHaveLength(6);
  });
});

describe('bank-branches.json（契約 v2.1 §6.2）', () => {
  it('cities 22 個且順序同 tw-districts.json', () => {
    expect(branches.cities).toEqual(districts.cities.map((c) => c.name));
  });
  it('每間銀行都有分行；元組 [4 碼, 非空名稱, 縣市索引]；每家內依代碼排序；總數 3508', () => {
    let n = 0;
    for (const b of banks) {
      const list = (branches.branches as unknown as Record<string, [string, string, number][]>)[b.code];
      expect(list?.length, b.code).toBeGreaterThan(0);
      expect(list.map((x) => x[0])).toEqual([...list.map((x) => x[0])].sort());
      for (const [code, name, city] of list) {
        expect(code).toMatch(/^[0-9]{4}$/);
        expect(name.length).toBeGreaterThan(0);
        expect(Number.isInteger(city) && city >= 0 && city < 22).toBe(true);
      }
      n += list.length;
    }
    expect(n).toBe(3508);
    expect(Object.keys(branches.branches)).toHaveLength(63);
  });
  it('臺灣銀行營業部 0037 在臺北市（地址前綴「台北市」已正規化成「臺」）', () => {
    const list = (branches.branches as unknown as Record<string, [string, string, number][]>)['004'];
    const b = list.find((x) => x[0] === '0037');
    expect(b && branches.cities[b[2]]).toBe('臺北市');
  });
});
