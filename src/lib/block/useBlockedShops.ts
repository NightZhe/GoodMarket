import { useCallback, useMemo, useSyncExternalStore } from 'react';
import type { StorageLike } from '../auth/pending';
import { BLOCK_KEY, addBlocked, parseBlocked, removeBlocked, type AddResult, type BlockedShop } from './store';

// 封鎖清單的即時同步：寫入後通知同分頁所有訂閱者（首頁、搜尋、店家頁…立即重算，不必重新整理）；
// 其他分頁寫入時由 storage 事件通知。

const EMPTY: BlockedShop[] = [];
const listeners = new Set<() => void>();
let cache: { raw: string | null; list: BlockedShop[] } = { raw: null, list: EMPTY };

function storage(): StorageLike | null {
  // 讀 window.localStorage 本身就可能丟 SecurityError（封鎖所有網站資料時）
  try { return typeof window === 'undefined' ? null : window.localStorage; } catch { return null; }
}

function snapshot(): BlockedShop[] {
  let raw: string | null = null;
  try { raw = storage()?.getItem(BLOCK_KEY) ?? null; } catch { raw = null; }
  // 字串沒變就回同一個陣列：useSyncExternalStore 要求沒變化時快照參考穩定
  if (raw !== cache.raw) cache = { raw, list: raw === null ? EMPTY : parseBlocked(raw) };
  return cache.list;
}

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  const onStorage = (e: StorageEvent) => { if (e.key === null || e.key === BLOCK_KEY) onChange(); };
  window.addEventListener('storage', onStorage);
  return () => { listeners.delete(onChange); window.removeEventListener('storage', onStorage); };
}

const emit = () => listeners.forEach(l => l());

export interface UseBlockedShops {
  /** 依封鎖時間新到舊 */
  shops: BlockedShop[];
  blockedIds: ReadonlySet<string>;
  isBlocked: (shopId: string) => boolean;
  /** 'ok'：已封鎖；'full'：已達 200 家；'failed'：這個瀏覽器不讓寫入 */
  block: (shop: { id: string; name: string }) => AddResult;
  /** false＝寫入失敗 */
  unblock: (shopId: string) => boolean;
}

export function useBlockedShops(): UseBlockedShops {
  const list = useSyncExternalStore(subscribe, snapshot, () => EMPTY);
  const blockedIds = useMemo<ReadonlySet<string>>(() => new Set(list.map(s => s.id)), [list]);
  const shops = useMemo(() => [...list].sort((a, b) => b.at - a.at), [list]);
  const isBlocked = useCallback((id: string) => blockedIds.has(id), [blockedIds]);
  const block = useCallback((shop: { id: string; name: string }): AddResult => {
    const s = storage();
    if (!s) return 'failed';
    const r = addBlocked(s, shop, Date.now());
    if (r === 'ok') emit();
    return r;
  }, []);
  const unblock = useCallback((id: string): boolean => {
    const s = storage();
    if (!s) return false;
    const ok = removeBlocked(s, id);
    if (ok) emit();
    return ok;
  }, []);
  return { shops, blockedIds, isBlocked, block, unblock };
}
