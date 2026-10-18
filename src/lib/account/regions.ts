import data from '../../data/tw-districts.json';

// 行政區清單（R-A18）。JSON 由 scripts/gen-tw-districts.mts 產生，打包進前端：
// 讀不到資料庫時結帳頁的手動表單仍然可以選縣市與區（AC-A36）。
// 同一個郵遞區號可能對到好幾個區（新竹市、嘉義市），所以只能由（縣市, 區）帶出郵遞區號，不能反查，也不能拿郵遞區號當 key。

export interface District { name: string; zip: string }
interface City { name: string; districts: District[] }

const CITIES: readonly City[] = data.cities;

export const cityNames = (): string[] => CITIES.map(c => c.name);

export const districtsOf = (city: string): readonly District[] =>
  CITIES.find(c => c.name === city)?.districts ?? [];

/** 由（縣市, 區）帶出 3 碼郵遞區號；不在清單裡（含「台」寫法）回傳 null */
export const zipOf = (city: string, district: string): string | null =>
  districtsOf(city).find(d => d.name === district)?.zip ?? null;

export const hasRegion = (city: string, district: string): boolean => zipOf(city, district) !== null;
