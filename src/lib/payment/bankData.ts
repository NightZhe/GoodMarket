// 銀行與分行清單（資料由 scripts/gen-banks.mts 產生，不手改）。
// 銀行清單小，進主 bundle；分行約 120 KB，使用者走到選分行才動態載入。logo 見 data/bankLogos.ts。
import banksJson from '../../data/banks.json';
import type { BankOption } from './bankAccount';

export interface BankRow extends BankOption { short: string | null; common: number | null }

export const BANKS: readonly BankRow[] = (banksJson as BankRow[]);

/** 常用銀行，依 common 順序 */
export const COMMON_BANKS: readonly BankRow[] = BANKS.filter(b => b.common !== null).sort((a, b) => (a.common ?? 0) - (b.common ?? 0));

export const bankByCode = (code: string): BankRow | null => BANKS.find(b => b.code === code) ?? null;

// ───────── 分行 ─────────

/** 分行元組：[分行代碼, 分行名稱, 縣市在 cities 的索引] */
export type BranchTuple = readonly [string, string, number];
export interface BranchData { cities: readonly string[]; branches: Readonly<Record<string, readonly BranchTuple[]>> }

const isTuple = (v: unknown): v is BranchTuple =>
  Array.isArray(v) && v.length === 3 && typeof v[0] === 'string' && typeof v[1] === 'string' && Number.isInteger(v[2]);

/** 不信任載入的檔案：形狀不對就拋錯（畫面顯示重試），不猜 */
export function parseBranchData(raw: unknown): BranchData {
  const r = raw as { cities?: unknown; branches?: unknown } | null;
  if (!r || !Array.isArray(r.cities) || !r.cities.every(c => typeof c === 'string') || typeof r.branches !== 'object' || r.branches === null) {
    throw new Error('branch data: bad shape');
  }
  const branches = r.branches as Record<string, unknown>;
  for (const list of Object.values(branches)) if (!Array.isArray(list) || !list.every(isTuple)) throw new Error('branch data: bad branches');
  return { cities: r.cities as string[], branches: branches as Record<string, BranchTuple[]> };
}

/** 該銀行有分行的縣市，依 cities 順序 */
export function citiesOf(data: BranchData, bankCode: string): string[] {
  const used = new Set((data.branches[bankCode] ?? []).map(b => b[2]));
  return data.cities.filter((_, i) => used.has(i));
}

/** 該銀行在某縣市的分行 */
export function branchesIn(data: BranchData, bankCode: string, city: string): { code: string; name: string }[] {
  const at = data.cities.indexOf(city);
  return (data.branches[bankCode] ?? []).filter(b => b[2] === at).map(b => ({ code: b[0], name: b[1] }));
}

let loading: Promise<BranchData> | null = null;
/** 動態載入分行清單（獨立 chunk）。失敗時下次呼叫會重新載入，所以「重試」有效 */
export function loadBranchData(): Promise<BranchData> {
  loading ??= import('../../data/bank-branches.json')
    .then(m => parseBranchData(m.default))
    .catch((e: unknown) => { loading = null; throw e; });
  return loading;
}
