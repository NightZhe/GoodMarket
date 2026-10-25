import type { StorageLike } from '../auth/pending';

// 封鎖店家（T3，R-K11）：只存在這台裝置的 localStorage，不送伺服器、不需要登入。
// 值：{ v: 1, shops: [{ id, name, at }] }。壞掉的值（非 JSON、型別不對）一律當作空清單，不丟錯。

export const BLOCK_KEY = 'goodmarket_blocked_shops';
/** 最多封鎖幾家（N13） */
export const BLOCK_LIMIT = 200;

export interface BlockedShop {
  id: string;
  /** 封鎖當下的店名：店被刪除後清單仍看得懂 */
  name: string;
  /** 封鎖時間（毫秒時間戳） */
  at: number;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** 解析儲存的字串。單筆壞掉只丟那一筆；整體壞掉回空清單；同一家只留第一筆 */
export function parseBlocked(raw: string | null): BlockedShop[] {
  if (!raw) return [];
  let data: unknown;
  try { data = JSON.parse(raw); } catch { return []; }
  if (!isObj(data) || data.v !== 1 || !Array.isArray(data.shops)) return [];
  const seen = new Set<string>();
  const out: BlockedShop[] = [];
  for (const s of data.shops) {
    if (!isObj(s) || typeof s.id !== 'string' || s.id === '' || typeof s.name !== 'string') continue;
    if (typeof s.at !== 'number' || !Number.isFinite(s.at)) continue;
    if (seen.has(s.id)) continue;
    seen.add(s.id);
    out.push({ id: s.id, name: s.name, at: s.at });
    if (out.length >= BLOCK_LIMIT) break;
  }
  return out;
}

export const serializeBlocked = (shops: BlockedShop[]): string => JSON.stringify({ v: 1, shops });

export function readBlocked(store: StorageLike): BlockedShop[] {
  try { return parseBlocked(store.getItem(BLOCK_KEY)); } catch { return []; }
}

/** 寫入失敗（例如私密模式）回 false，呼叫端要告訴使用者，不能假裝封鎖成功 */
function write(store: StorageLike, shops: BlockedShop[]): boolean {
  try {
    store.setItem(BLOCK_KEY, serializeBlocked(shops));
    return true;
  } catch {
    return false;
  }
}

export type AddResult = 'ok' | 'full' | 'failed';

/** 已經封鎖的再加一次當作成功（不重複、不佔額度）；第 201 家回 'full'、不寫入 */
export function addBlocked(store: StorageLike, shop: { id: string; name: string }, now: number): AddResult {
  const list = readBlocked(store);
  if (list.some(s => s.id === shop.id)) return 'ok';
  if (list.length >= BLOCK_LIMIT) return 'full';
  return write(store, [...list, { id: shop.id, name: shop.name, at: now }]) ? 'ok' : 'failed';
}

/** 沒封鎖的店取消也算成功 */
export function removeBlocked(store: StorageLike, id: string): boolean {
  const list = readBlocked(store);
  if (!list.some(s => s.id === id)) return true;
  return write(store, list.filter(s => s.id !== id));
}
