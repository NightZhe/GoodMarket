import { describe, expect, it } from 'vitest';
import {
  CITY_ORDER,
  EXCLUDED,
  buildDistricts,
  parseGeoXml,
  parseZipTxt,
  crossCheck,
  renderJson,
  renderSqlBlock,
  extractSqlBlock,
  spliceSqlBlock,
  splitName,
  type TwDistricts,
} from '../../scripts/lib/tw-districts-core';

// 行政區清單：產生器（scripts/gen-tw-districts.mts）與一致性測試。
// 真實檔案用 vite 的 ?raw 讀（不用 node:fs，避免 tsc --noEmit 需要 node 型別）。
const raw = (g: Record<string, unknown>): string => {
  const v = Object.values(g);
  if (v.length !== 1) throw new Error(`預期剛好 1 個檔案，實際 ${v.length}`);
  return v[0] as string;
};
const SRC_XML = raw(import.meta.glob('../../scripts/data/tw-districts-source/post-geo-8.1.xml', { query: '?raw', import: 'default', eager: true }));
const SRC_TXT = raw(import.meta.glob('../../scripts/data/tw-districts-source/post-zip3-7.3.utf8.txt', { query: '?raw', import: 'default', eager: true }));
const JSON_TEXT = raw(import.meta.glob('./tw-districts.json', { query: '?raw', import: 'default', eager: true }));
const MIGRATION = raw(import.meta.glob('../../supabase/migrations/*_account_profile_addresses.sql', { query: '?raw', import: 'default', eager: true }));

const xmlItem = (name: string, zip: string) =>
  `<_x0031_050429_行政區經緯度_x0028_toPost_x0029_>\n<行政區名>${name}</行政區名>\n<_x0033_碼郵遞區號>${zip}</_x0033_碼郵遞區號>\n</_x0031_050429_行政區經緯度_x0028_toPost_x0029_>\n`;
const xmlOf = (items: [string, string][]) => `<?xml version="1.0"?><dataroot>${items.map(([n, z]) => xmlItem(n, z)).join('')}</dataroot>`;

describe('parseGeoXml / splitName（單元，用小檔）', () => {
  it('讀出名稱與 3 碼，並處理 XML 跳脫', () => {
    expect(parseGeoXml(xmlOf([['臺北市中正區', '100'], ['新竹市東區', '300']]))).toEqual([
      { name: '臺北市中正區', zip: '100' },
      { name: '新竹市東區', zip: '300' },
    ]);
  });
  it('郵遞區號不是 3 位數字就丟錯，不默默吞掉', () => {
    expect(() => parseGeoXml(xmlOf([['臺北市中正區', '10']]))).toThrow(/郵遞區號/);
    expect(() => parseGeoXml(xmlOf([['臺北市中正區', '1000']]))).toThrow(/郵遞區號/);
  });
  it('一筆都讀不到就丟錯（來源檔格式變了）', () => {
    expect(() => parseGeoXml('<dataroot></dataroot>')).toThrow();
  });
  it('splitName 用 22 個縣市名切；不認得的縣市丟錯', () => {
    expect(CITY_ORDER).toHaveLength(22);
    expect(splitName('臺北市大安區')).toEqual({ city: '臺北市', district: '大安區' });
    expect(splitName('連江縣南竿鄉')).toEqual({ city: '連江縣', district: '南竿鄉' });
    expect(() => splitName('火星市中正區')).toThrow(/縣市/);
    expect(() => splitName('臺北市')).toThrow(/鄉鎮市區/);
  });
});

describe('buildDistricts（單元）', () => {
  it('依縣市官方順序分組、排除 A-27 項目、保留同碼多區', () => {
    const d = buildDistricts([
      { name: '新竹市北區', zip: '300' }, { name: '新竹市東區', zip: '300' },
      { name: '臺北市大安區', zip: '106' },
      { name: '宜蘭縣釣魚臺列嶼', zip: '290' }, { name: '高雄市東沙群島', zip: '817' }, { name: '高雄市南沙群島', zip: '819' },
    ]);
    expect(d.cities.map(c => c.name)).toEqual(['臺北市', '新竹市']);
    expect(d.cities[1].districts).toEqual([{ name: '北區', zip: '300' }, { name: '東區', zip: '300' }]);
    expect(JSON.stringify(d.cities)).not.toMatch(/釣魚臺|東沙|南沙/);
    expect(d.meta.excluded.map(e => e.zip)).toEqual(['290', '817', '819']);
  });
  it('同一個縣市出現重複的區就丟錯', () => {
    expect(() => buildDistricts([{ name: '臺北市大安區', zip: '106' }, { name: '臺北市大安區', zip: '106' }])).toThrow(/重複/);
  });
  it('排除清單恰好是 3 項，各有理由', () => {
    expect(EXCLUDED.map(e => e.zip).sort()).toEqual(['290', '817', '819']);
    for (const e of EXCLUDED) expect(e.reason.length).toBeGreaterThan(3);
  });
});

describe('SQL 區塊（單元）', () => {
  const d: TwDistricts = { meta: { source: 's', files: [], excluded: [] }, cities: [{ name: '臺北市', districts: [{ name: "大'安區", zip: '106' }] }] };
  it('單引號跳脫、含標記', () => {
    const sql = renderSqlBlock(d);
    expect(sql).toContain("('臺北市', '大''安區', '106')");
    expect(sql.startsWith('-- BEGIN GENERATED tw_districts')).toBe(true);
    expect(sql.trimEnd().endsWith('-- END GENERATED tw_districts')).toBe(true);
  });
  it('splice 只換標記之間，其他不動；沒有標記就丟錯', () => {
    const file = `a\n-- BEGIN GENERATED tw_districts\nOLD\n-- END GENERATED tw_districts\nb\n`;
    const out = spliceSqlBlock(file, 'NEW');
    expect(out).toBe(`a\nNEW\nb\n`);
    expect(() => spliceSqlBlock('沒有標記', 'NEW')).toThrow(/標記/);
    expect(extractSqlBlock(file)).toBe('-- BEGIN GENERATED tw_districts\nOLD\n-- END GENERATED tw_districts');
  });
});

describe('真實來源檔（中華郵政）', () => {
  const rows = parseGeoXml(SRC_XML);
  const data = buildDistricts(rows);

  it('XML 371 筆，排除 3 筆後剩 368 筆；22 縣市', () => {
    expect(rows).toHaveLength(371);
    expect(data.cities).toHaveLength(22);
    expect(data.cities.reduce((n, c) => n + c.districts.length, 0)).toBe(368);
  });
  it('前3碼一覽表（7.3）與經緯度表（8.1）的郵遞區號集合一致，且每個名稱對得上', () => {
    const txt = parseZipTxt(SRC_TXT);
    expect(crossCheck(rows, txt)).toEqual([]);
  });
  it('crossCheck 真的會抓到差異（負向測試）', () => {
    const txt = parseZipTxt(SRC_TXT);
    expect(crossCheck(rows.slice(1), txt).length).toBeGreaterThan(0);
    expect(crossCheck(rows.map(r => (r.zip === '106' ? { ...r, zip: '107' } : r)), txt).length).toBeGreaterThan(0);
  });
  it('AC-A32 抽測：郵遞區號與中華郵政檔案一致', () => {
    const zip = (city: string, district: string) =>
      data.cities.find(c => c.name === city)?.districts.find(x => x.name === district)?.zip;
    expect(zip('臺北市', '大安區')).toBe('106');
    expect(zip('桃園市', '中壢區')).toBe('320');
    expect(zip('新竹市', '東區')).toBe('300');
    expect(zip('連江縣', '南竿鄉')).toBe('209');
    expect(zip('澎湖縣', '馬公市')).toBe('880');
  });
  it('同碼多區：新竹市 3 區共用 300、嘉義市 2 區共用 600（只能由區帶出郵遞區號）', () => {
    const c = (n: string) => data.cities.find(x => x.name === n)!.districts;
    expect(c('新竹市').map(d => d.zip)).toEqual(['300', '300', '300']);
    expect(c('嘉義市').map(d => d.zip)).toEqual(['600', '600']);
  });
  it('排除的項目不在清單裡（A-27）', () => {
    const all = data.cities.flatMap(c => c.districts.map(d => `${c.name}${d.name}`));
    for (const n of ['宜蘭縣釣魚臺列嶼', '高雄市東沙群島', '高雄市南沙群島']) expect(all).not.toContain(n);
    expect(all).toContain('金門縣烏坵鄉'); // 有人居住，保留
  });
});

describe('產生物一致性', () => {
  const data = buildDistricts(parseGeoXml(SRC_XML));
  it('src/data/tw-districts.json 就是產生器現在的輸出（沒人手改、沒過期）', () => {
    expect(JSON_TEXT).toBe(renderJson(data));
  });
  it('migration 裡的資料表內容就是產生器現在的輸出，與 JSON 同一份來源', () => {
    expect(extractSqlBlock(MIGRATION)).toBe(renderSqlBlock(JSON.parse(JSON_TEXT) as TwDistricts).trimEnd());
  });
  it('JSON 結構：縣市名唯一、(縣市,區) 唯一、郵遞區號 3 碼數字', () => {
    const j = JSON.parse(JSON_TEXT) as TwDistricts;
    const seen = new Set<string>();
    for (const c of j.cities) for (const d of c.districts) {
      const k = `${c.name}|${d.name}`;
      expect(seen.has(k)).toBe(false);
      seen.add(k);
      expect(d.zip).toMatch(/^[0-9]{3}$/);
    }
    expect(new Set(j.cities.map(c => c.name)).size).toBe(j.cities.length);
  });
});
