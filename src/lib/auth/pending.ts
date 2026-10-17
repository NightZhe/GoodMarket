import type { CartItem, Order } from '../../types';

// 待辦動作（pending action）：遊客按下「加入購物車」「直接購買」，或結帳時登入過期，
// 要先登入才能做。登入是整頁跳到 Google／Apple 再回來，頁面上的狀態全部會消失，
// 所以把「登入後要做什麼」暫存在瀏覽器，回來之後讀出來、只執行一次。
//   - 兩個儲存位置都寫（sessionStorage 跟著分頁、localStorage 保底），讀取優先 sessionStorage，
//     取用時兩邊一起刪：重新整理、上一頁、兩個分頁都不會讓同一筆動作做第二次。
//   - 60 分鐘過期。過期的紀錄仍然讀得到（要告訴使用者「登入花了比較久」），但不可以執行。
//   - 同一時間只保留最新一筆。
//   - 不存價格：價格永遠以回來之後讀到的商品資料為準。

export const PENDING_KEY = 'goodmarket_pending_action';
export const PENDING_TTL_MS = 60 * 60 * 1000;

export type PaymentMethod = Order['payment'];
export type BuyerDraft = Order['buyer'];

export type PendingAction =
  | { kind: 'add_to_cart'; productId: string; variantId: string; qty: number; returnTo: string; createdAt: number }
  | { kind: 'buy_now'; productId: string; variantId: string; qty: number; returnTo: string; createdAt: number }
  /** 結帳時 session 過期：品項、是否來自購物車、付款方式、已填的收件資料都要還原 */
  | { kind: 'checkout'; items: CartItem[]; fromCart: boolean; payment: PaymentMethod; buyer: BuyerDraft; returnTo: string; createdAt: number }
  /** 沒有動作要做，只是登入完回到某一頁 */
  | { kind: 'goto'; returnTo: string; createdAt: number };

/** 呼叫端只給「是什麼動作」，回到哪一頁與建立時間由存取層補上 */
export type PendingInput =
  | { kind: 'add_to_cart' | 'buy_now'; productId: string; variantId: string; qty: number }
  | { kind: 'checkout'; items: CartItem[]; fromCart: boolean; payment: PaymentMethod; buyer: BuyerDraft }
  | { kind: 'goto' };

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const PAYMENTS: readonly string[] = ['cod', 'card', 'transfer'];
const MAX_QTY = 999;
const MAX_ITEMS = 50;
const MAX_ID_LENGTH = 100;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isId = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= MAX_ID_LENGTH;
const isQty = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= MAX_QTY;
const isTime = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0;

/** 回到哪一頁只收站內路徑（以 / 開頭、不是 //、沒有控制字元），其餘一律當作壞資料 */
export const isSafeRoute = (v: unknown): v is string =>
  typeof v === 'string' && v.length <= 300 && /^\/(?!\/)[^\s\\]*$/.test(v);

function parseItems(v: unknown): CartItem[] | null {
  if (!Array.isArray(v) || v.length === 0 || v.length > MAX_ITEMS) return null;
  const out: CartItem[] = [];
  for (const i of v) {
    if (!isObj(i) || !isId(i.productId) || !isId(i.variantId) || !isQty(i.qty)) return null;
    out.push({ productId: i.productId, variantId: i.variantId, qty: i.qty });
  }
  return out;
}

/** 讀回來的資料一律當作不可信：任何一個欄位不對就整筆丟掉，不要拿壞資料去執行動作 */
export function parsePending(raw: string | null): PendingAction | null {
  if (!raw) return null;
  let data: unknown;
  try { data = JSON.parse(raw); } catch { return null; }
  if (!isObj(data) || !isSafeRoute(data.returnTo) || !isTime(data.createdAt)) return null;
  const base = { returnTo: data.returnTo, createdAt: data.createdAt };
  switch (data.kind) {
    case 'add_to_cart':
    case 'buy_now':
      if (!isId(data.productId) || !isId(data.variantId) || !isQty(data.qty)) return null;
      return { kind: data.kind, productId: data.productId, variantId: data.variantId, qty: data.qty, ...base };
    case 'checkout': {
      const items = parseItems(data.items);
      const b = data.buyer;
      if (!items || typeof data.fromCart !== 'boolean' || typeof data.payment !== 'string' || !PAYMENTS.includes(data.payment)) return null;
      if (!isObj(b) || typeof b.name !== 'string' || typeof b.phone !== 'string' || typeof b.address !== 'string') return null;
      return {
        kind: 'checkout', items, fromCart: data.fromCart, payment: data.payment as PaymentMethod,
        buyer: { name: b.name.slice(0, 100), phone: b.phone.slice(0, 30), address: b.address.slice(0, 300) }, ...base,
      };
    }
    case 'goto':
      return { kind: 'goto', ...base };
    default:
      return null;
  }
}

/** 加入購物車、直接購買固定回到那件商品的頁面；其他動作回到呼叫端給的頁面 */
export function buildPending(input: PendingInput, currentRoute: string, now: number): PendingAction {
  const route = isSafeRoute(currentRoute) ? currentRoute : '/';
  switch (input.kind) {
    case 'add_to_cart':
    case 'buy_now':
      return { ...input, returnTo: `/product/${encodeURIComponent(input.productId)}`, createdAt: now };
    case 'checkout':
      return { ...input, returnTo: '/checkout', createdAt: now };
    case 'goto':
      return { kind: 'goto', returnTo: route, createdAt: now };
  }
}

export const isExpired = (a: PendingAction, now: number) => now - a.createdAt >= PENDING_TTL_MS;

export interface PendingRecord { action: PendingAction; expired: boolean }

/** 寫入所有可用的儲存位置；至少一個成功就算成功。回傳 false＝這個瀏覽器擋住暫存，登入後無法自動完成 */
export function savePending(stores: StorageLike[], action: PendingAction): boolean {
  const raw = JSON.stringify(action);
  let ok = false;
  for (const s of stores) {
    try { s.setItem(PENDING_KEY, raw); ok = true; } catch { /* 這個儲存位置寫不進去，試下一個 */ }
  }
  return ok;
}

export function clearPending(stores: StorageLike[]): void {
  for (const s of stores) {
    try { s.removeItem(PENDING_KEY); } catch { /* 刪不掉也沒有更多能做的 */ }
  }
}

function readRaw(stores: StorageLike[]): string | null {
  for (const s of stores) {
    try {
      const v = s.getItem(PENDING_KEY);
      if (v) return v;
    } catch { /* 讀不到就換下一個 */ }
  }
  return null;
}

/** 只看不取：商品頁用來還原規格與數量。過期的也讀得到，由呼叫端決定怎麼用 */
export function peekPending(stores: StorageLike[], now: number): PendingRecord | null {
  const action = parsePending(readRaw(stores));
  return action ? { action, expired: isExpired(action, now) } : null;
}

/** 取用：讀出來並立刻從所有位置刪掉。壞資料也會被刪掉並回傳 null */
export function takePending(stores: StorageLike[], now: number): PendingRecord | null {
  const raw = readRaw(stores);
  clearPending(stores);
  const action = parsePending(raw);
  return action ? { action, expired: isExpired(action, now) } : null;
}

/** 這個瀏覽器能不能暫存（無痕模式、儲存空間已滿、被擋）：寫一筆探測值再刪掉 */
export function canPersist(stores: StorageLike[]): boolean {
  const probe = `${PENDING_KEY}_probe`;
  for (const s of stores) {
    try {
      s.setItem(probe, '1');
      s.removeItem(probe);
      return true;
    } catch { /* 試下一個 */ }
  }
  return false;
}

/** 瀏覽器端的儲存位置，順序＝讀取優先順序。存取 storage 本身也可能丟例外（隱私設定），要包起來 */
export function browserStores(): StorageLike[] {
  const out: StorageLike[] = [];
  try { if (typeof sessionStorage !== 'undefined') out.push(sessionStorage); } catch { /* 被擋 */ }
  try { if (typeof localStorage !== 'undefined') out.push(localStorage); } catch { /* 被擋 */ }
  return out;
}

// ───────── LINE 外開：儲存位置不互通，待辦動作要放在網址上帶過去 ─────────
// 只有「加入購物車」「直接購買」與「純登入」會走到這裡（登入過期的結帳資料含收件人資訊，不放網址）。

export const HANDOFF_PARAMS = ['pa', 'pp', 'pv', 'pq', 'pt'] as const;

/** 把待辦動作編成網址參數；不適合放網址的種類回傳 null（沒有動作的純登入用 pa=login） */
export function pendingToParams(a: PendingAction): URLSearchParams | null {
  const p = new URLSearchParams();
  switch (a.kind) {
    case 'add_to_cart':
    case 'buy_now':
      p.set('pa', a.kind === 'add_to_cart' ? 'cart' : 'buy');
      p.set('pp', a.productId);
      p.set('pv', a.variantId);
      p.set('pq', String(a.qty));
      p.set('pt', String(a.createdAt));
      return p;
    case 'goto':
      p.set('pa', 'login');
      p.set('pt', String(a.createdAt));
      return p;
    case 'checkout':
      return null;
  }
}

/**
 * 從網址參數還原待辦動作。網址是任何人都能亂改的輸入，所以走跟 parsePending 同一套驗證：
 * 欄位不對就當作沒有。currentRoute 是網址 # 後面的站內路徑，只有 pa=login 會用到。
 */
export function paramsToPending(params: URLSearchParams, currentRoute: string, now: number): PendingAction | null {
  const kind = params.get('pa');
  if (!kind) return null;
  const createdAtRaw = Number(params.get('pt'));
  // 時間戳記不能是未來（改網址想讓它永遠不過期）；沒有或不合理就當作現在建立
  const createdAt = isTime(createdAtRaw) && createdAtRaw <= now ? createdAtRaw : now;
  if (kind === 'login') return { kind: 'goto', returnTo: isSafeRoute(currentRoute) ? currentRoute : '/', createdAt };
  if (kind !== 'cart' && kind !== 'buy') return null;
  const productId = params.get('pp');
  const variantId = params.get('pv');
  const qty = Number(params.get('pq'));
  if (!isId(productId) || !isId(variantId) || !isQty(qty)) return null;
  return {
    kind: kind === 'cart' ? 'add_to_cart' : 'buy_now', productId, variantId, qty,
    returnTo: `/product/${encodeURIComponent(productId)}`, createdAt,
  };
}
