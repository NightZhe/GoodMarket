import { describe, expect, it } from 'vitest';
import { cityNames, districtsOf, hasRegion, zipOf } from './regions';

// 行政區連動（AC-A32、A33、A36）。期望值來自規格抽測清單與中華郵政檔案，不是用程式自己算出來的。
describe('縣市 → 鄉鎮市區 → 郵遞區號', () => {
  it('縣市下拉照官方順序，22 個，用字是「臺」', () => {
    const names = cityNames();
    expect(names).toHaveLength(22);
    expect(names[0]).toBe('臺北市');
    expect(names).toContain('臺中市');
    expect(names).not.toContain('台北市');
  });
  it('規格抽測：五組郵遞區號與中華郵政一致（AC-A32）', () => {
    expect(zipOf('臺北市', '大安區')).toBe('106');
    expect(zipOf('桃園市', '中壢區')).toBe('320');
    expect(zipOf('新竹市', '東區')).toBe('300');
    expect(zipOf('連江縣', '南竿鄉')).toBe('209');
    expect(zipOf('澎湖縣', '馬公市')).toBe('880');
  });
  it('只列該縣市的區：臺北市沒有中壢區', () => {
    const names = districtsOf('臺北市').map(d => d.name);
    expect(names).toContain('大安區');
    expect(names).not.toContain('中壢區');
    expect(districtsOf('桃園市').map(d => d.name)).toContain('中壢區');
  });
  it('同一個郵遞區號對到多個區時，仍由（縣市, 區）各自帶出', () => {
    expect(zipOf('新竹市', '北區')).toBe('300');
    expect(zipOf('新竹市', '香山區')).toBe('300');
    expect(zipOf('嘉義市', '西區')).toBe('600');
  });
  it('找不到的組合回傳 null，不猜', () => {
    expect(zipOf('臺北市', '中壢區')).toBeNull();
    expect(zipOf('台北市', '大安區')).toBeNull();
    expect(zipOf('', '')).toBeNull();
    expect(districtsOf('不存在市')).toEqual([]);
  });
  it('hasRegion 只認清單裡的組合；被排除的離島不在清單裡', () => {
    expect(hasRegion('臺北市', '大安區')).toBe(true);
    expect(hasRegion('臺北市', '中壢區')).toBe(false);
    expect(hasRegion('高雄市', '東沙群島')).toBe(false);
  });
});
