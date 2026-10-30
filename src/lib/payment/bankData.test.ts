import { describe, expect, it } from 'vitest';
import { BANKS, COMMON_BANKS, bankByCode, branchesIn, citiesOf, loadBranchData, parseBranchData } from './bankData';

const fixture = { cities: ['臺北市', '基隆市', '新北市'], branches: { '004': [['0037', '營業部', 0], ['0048', '板橋分行', 2], ['0059', '中山分行', 0]], '700': [['0001', '郵局', 1]] } };

describe('分行清單（fixture）', () => {
  const data = parseBranchData(fixture);
  it('縣市只列該銀行有分行的，依 cities 順序', () => {
    expect(citiesOf(data, '004')).toEqual(['臺北市', '新北市']);
    expect(citiesOf(data, '700')).toEqual(['基隆市']);
    expect(citiesOf(data, '999')).toEqual([]);
  });
  it('某縣市的分行', () => {
    expect(branchesIn(data, '004', '臺北市')).toEqual([{ code: '0037', name: '營業部' }, { code: '0059', name: '中山分行' }]);
    expect(branchesIn(data, '004', '基隆市')).toEqual([]);
  });
  it('形狀不對拋錯', () => {
    expect(() => parseBranchData(null)).toThrow();
    expect(() => parseBranchData({ cities: [1], branches: {} })).toThrow();
    expect(() => parseBranchData({ cities: [], branches: { '004': [['0037', '營業部']] } })).toThrow();
  });
});

describe('真實資料檔', () => {
  it('分行檔載入後每家有分行的銀行都有縣市', async () => {
    const data = await loadBranchData();
    expect(data.cities).toHaveLength(22);
    expect(citiesOf(data, '822').length).toBeGreaterThan(5);
    expect(branchesIn(data, '822', '臺北市').length).toBeGreaterThan(10);
  });
  it('常用銀行 6 家，順序照蝦皮：中國信託、國泰世華、玉山、台北富邦、中華郵政、兆豐', () => {
    expect(COMMON_BANKS.map(b => b.code)).toEqual(['822', '013', '808', '012', '700', '017']);
    expect(COMMON_BANKS.map(b => b.short)).toEqual(['中國信託', '國泰世華', '玉山', '台北富邦', '中華郵政', '兆豐']);
    expect(BANKS).toHaveLength(63);
    expect(bankByCode('822')?.name).toBe('中國信託商業銀行');
  });
});
