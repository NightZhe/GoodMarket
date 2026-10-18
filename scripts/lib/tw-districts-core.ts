// 行政區清單產生器的純函式（不碰檔案系統，方便單元測試；CLI 在 scripts/gen-tw-districts.mts）。
// 來源：中華郵政「下載專區」8.1「3碼郵遞區號與行政區中心點經緯度對照表」(XML)，
//   用 7.3「臺灣地區郵遞區號前3碼一覽表 103/12」(TXT) 交叉核對。見 scripts/data/tw-districts-source/SOURCE.md。

export interface DistrictRow { name: string; zip: string }          // name＝縣市＋鄉鎮市區（官方原文）
export interface District { name: string; zip: string }
export interface City { name: string; districts: District[] }
export interface TwDistricts {
  meta: { source: string; files: string[]; excluded: { name: string; zip: string; reason: string }[] };
  cities: City[];
}

/** 22 個縣市，官方表的順序（也是下拉選單的順序） */
export const CITY_ORDER = [
  '臺北市', '基隆市', '新北市', '宜蘭縣', '新竹市', '新竹縣', '桃園市', '苗栗縣', '臺中市', '彰化縣', '南投縣',
  '嘉義市', '嘉義縣', '雲林縣', '臺南市', '高雄市', '澎湖縣', '金門縣', '連江縣', '屏東縣', '臺東縣', '花蓮縣',
] as const;

/** A-27：沒有一般住址的項目不列入。 */
export const EXCLUDED = [
  { name: '宜蘭縣釣魚臺列嶼', zip: '290', reason: '釣魚臺列嶼：不是一般鄉鎮市區，沒有一般住址' },
  { name: '高雄市東沙群島', zip: '817', reason: '東沙群島：不是一般鄉鎮市區，沒有一般住址' },
  { name: '高雄市南沙群島', zip: '819', reason: '南沙群島：不是一般鄉鎮市區，沒有一般住址' },
] as const;

const decodeXml = (s: string) =>
  s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');

/** 讀 8.1 XML。任何一筆郵遞區號不是 3 位數字就丟錯；一筆都沒有也丟錯（代表來源檔格式變了）。 */
export function parseGeoXml(xml: string): DistrictRow[] {
  const re = /<行政區名>([\s\S]*?)<\/行政區名>\s*<_x0033_碼郵遞區號>([\s\S]*?)<\/_x0033_碼郵遞區號>/g;
  const out: DistrictRow[] = [];
  for (let m = re.exec(xml); m; m = re.exec(xml)) {
    const name = decodeXml(m[1]).trim();
    const zip = m[2].trim();
    if (!/^[0-9]{3}$/.test(zip)) throw new Error(`郵遞區號不是 3 位數字：${name} → ${JSON.stringify(zip)}`);
    if (name === '') throw new Error('行政區名是空的');
    out.push({ name, zip });
  }
  if (out.length === 0) throw new Error('來源 XML 讀不到任何行政區（格式變了？）');
  return out;
}

export function splitName(full: string): { city: string; district: string } {
  const city = CITY_ORDER.find(c => full.startsWith(c));
  if (!city) throw new Error(`認不得縣市：${full}`);
  const district = full.slice(city.length);
  if (district === '') throw new Error(`沒有鄉鎮市區：${full}`);
  return { city, district };
}

export function buildDistricts(rows: DistrictRow[]): TwDistricts {
  const excludedNames = new Set<string>(EXCLUDED.map(e => e.name));
  const byCity = new Map<string, District[]>();
  const seen = new Set<string>();
  for (const r of rows) {
    if (excludedNames.has(r.name)) continue;
    const { city, district } = splitName(r.name);
    if (seen.has(r.name)) throw new Error(`重複的行政區：${r.name}`);
    seen.add(r.name);
    byCity.set(city, [...(byCity.get(city) ?? []), { name: district, zip: r.zip }]);
  }
  const cities: City[] = CITY_ORDER.filter(c => byCity.has(c)).map(c => ({ name: c, districts: byCity.get(c)! }));
  return {
    meta: {
      source: '中華郵政 下載專區 8.1「3碼郵遞區號與行政區中心點經緯度對照表」(XML，112/04/14 更新)；交叉核對 7.3「臺灣地區郵遞區號前3碼一覽表」(103/12)',
      files: ['post-geo-8.1.xml', 'post-zip3-7.3.utf8.txt'],
      excluded: EXCLUDED.map(e => ({ name: e.name, zip: e.zip, reason: e.reason })),
    },
    cities,
  };
}

/** 讀 7.3 TXT（4 欄並排的版面）：回傳「郵遞區號 → 名稱（去掉內部空白）」。 */
export function parseZipTxt(txt: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const rawLine of txt.replace(/\r/g, '').split('\n')) {
    const line = rawLine.replace(/\t/g, '   ');
    const re = /(\d{3})(?!\d)/g;
    let last = 0;
    for (let m = re.exec(line); m; m = re.exec(line)) {
      const segment = line.slice(last, m.index).trim();
      last = m.index + 3;
      // 縣市標題與區名之間至少隔 3 個空白；區名內部（例如「竹  北」）只有 2 個
      const cell = segment.split(/\s{3,}/).pop() ?? '';
      const name = cell.replace(/\s+/g, '');
      if (name === '') continue;
      out.set(m[1], name);
    }
  }
  return out;
}

/**
 * 交叉核對 8.1（rows）與 7.3（txt）。回傳問題清單，空陣列＝一致。
 * 規則：兩邊的郵遞區號集合必須相同（8.1 的排除項目也要在 7.3 找得到）；
 *       7.3 的名稱（去空白、無「市鄉鎮區」後綴）必須是 8.1 該碼任一區名的前綴。
 */
export function crossCheck(rows: DistrictRow[], txt: Map<string, string>): string[] {
  const problems: string[] = [];
  const xmlZips = new Map<string, string[]>();
  for (const r of rows) xmlZips.set(r.zip, [...(xmlZips.get(r.zip) ?? []), r.name]);
  for (const z of xmlZips.keys()) if (!txt.has(z)) problems.push(`8.1 有 ${z}（${xmlZips.get(z)!.join('、')}），7.3 沒有`);
  for (const z of txt.keys()) if (!xmlZips.has(z)) problems.push(`7.3 有 ${z}（${txt.get(z)}），8.1 沒有`);
  for (const [z, tname] of txt) {
    const names = xmlZips.get(z);
    if (!names) continue;
    const ok = names.some(n => {
      const d = n.replace(/^(?:臺北市|基隆市|新北市|宜蘭縣|新竹市|新竹縣|桃園市|苗栗縣|臺中市|彰化縣|南投縣|嘉義市|嘉義縣|雲林縣|臺南市|高雄市|澎湖縣|金門縣|連江縣|屏東縣|臺東縣|花蓮縣)/, '');
      // 7.3 的 300／600 是縣市層級（新竹市、嘉義市）
      return d.startsWith(tname) || n === tname || n.startsWith(tname);
    });
    if (!ok) problems.push(`${z}：7.3 寫「${tname}」，8.1 寫「${names.join('、')}」，對不上`);
  }
  return problems;
}

export const renderJson = (d: TwDistricts): string => JSON.stringify(d, null, 1) + '\n';

const BEGIN = '-- BEGIN GENERATED tw_districts';
const END = '-- END GENERATED tw_districts';
const q = (s: string) => `'${s.replace(/'/g, "''")}'`;

/** 給 migration 的資料表內容（含起訖標記）。 */
export function renderSqlBlock(d: TwDistricts): string {
  const rows = d.cities.flatMap(c => c.districts.map(x => `  (${q(c.name)}, ${q(x.name)}, ${q(x.zip)})`));
  return [
    `${BEGIN} (scripts/gen-tw-districts.mts 產生，請勿手改；來源與排除項目見 scripts/data/tw-districts-source/SOURCE.md)`,
    'insert into public.tw_districts (city, district, postal_code) values',
    rows.join(',\n'),
    'on conflict (city, district) do update set postal_code = excluded.postal_code;',
    END,
    '',
  ].join('\n');
}

const markerIndexes = (file: string) => {
  const b = file.indexOf(BEGIN);
  const e = file.indexOf(END);
  if (b < 0 || e < 0 || e < b) throw new Error('找不到 GENERATED 標記');
  return { b, e: e + END.length };
};

export function extractSqlBlock(file: string): string {
  const { b, e } = markerIndexes(file);
  return file.slice(b, e);
}

/** 把標記之間（含標記）換成 block（block 自帶標記；測試用的簡化字串也行）。 */
export function spliceSqlBlock(file: string, block: string): string {
  const { b, e } = markerIndexes(file);
  return file.slice(0, b) + block.replace(/\n$/, '') + file.slice(e);
}
