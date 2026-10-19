import type { CheckoutRejection } from '../../types';
import { money } from '../format';
import { AccountError } from './errors';

// 結帳比價（.work/checkout-price-check/）：失敗畫面與購物車標示用的純函式。
// 文案以 design.md 第 7 節為準；畫面只負責排版。

/** 品項的比對鍵（同購物車）：商品＋規格 */
export const itemKey = (c: { productId: string; variantId: string }) => `${c.productId}|${c.variantId}`;

/**
 * 失敗畫面的說明句，切成片段（每段在畫面上包一個 inline-block，只在標點後換行）。
 * 片段依序只放出現的類別：價格變動的品項數、庫存不足的品項數、運費變動的店數
 */
export function rejectionSentence(changes: CheckoutRejection[]): string[] {
  const count = (kind: CheckoutRejection['kind']) =>
    new Set(changes.filter(c => c.kind === kind).map(c => (c.kind === 'shipping' ? c.shopId : itemKey(c)))).size;
  const parts = [
    [count('price'), '件商品價格變動'],
    [count('stock'), '件商品庫存不足'],
    [count('shipping'), '家商店的運費變動'],
  ].filter(([n]) => n).map(([n, text]) => `${n} ${text}`);
  return parts.map((p, i) => `${i === 0 ? '你結帳時有 ' : ''}${p}${i === parts.length - 1 ? '，' : '、'}`).concat('這次沒有成立任何訂單。');
}

/** 說明句之後的補句：送出含兩家以上商店、從購物車結帳時各一句（依序） */
export function rejectionNotes({ shopCount, fromCart }: { shopCount: number; fromCart: boolean }): string[] {
  const notes: string[] = [];
  if (shopCount >= 2) notes.push('同一次結帳的其他商店商品也沒有下單。');
  if (fromCart) notes.push('購物車裡的商品都還在，數量沒有變。');
  return notes;
}

export interface RejectedItem {
  productId: string;
  variantId: string;
  title: string;
  variantName: string;
  price: { seen: number; current: number } | null;
  stock: { qty: number; left: number } | null;
}

export interface RejectedShop {
  shopId: string;
  /** 只有運費變動的回傳帶店名；畫面優先用記憶體裡的商店資料 */
  shopName: string | null;
  items: RejectedItem[];
  shipping: { seen: number; current: number } | null;
}

/**
 * 依商店分組：店依「這次送出裡第一次出現的順序」（shopOrder，結帳頁的分組順序），店內品項依回傳順序；
 * 同一件（商品＋規格）的價格與庫存問題併成一列。沒有問題的店不列
 */
export function groupRejections(changes: CheckoutRejection[], shopOrder: string[]): RejectedShop[] {
  const shops = new Map<string, RejectedShop>();
  const shopOf = (shopId: string) => {
    let s = shops.get(shopId);
    if (!s) { s = { shopId, shopName: null, items: [], shipping: null }; shops.set(shopId, s); }
    return s;
  };
  for (const c of changes) {
    const shop = shopOf(c.shopId);
    if (c.kind === 'shipping') {
      shop.shopName = c.shopName;
      shop.shipping ??= { seen: c.seenFee, current: c.currentFee };
      continue;
    }
    let item = shop.items.find(i => itemKey(i) === itemKey(c));
    if (!item) {
      item = { productId: c.productId, variantId: c.variantId, title: c.title, variantName: c.variantName, price: null, stock: null };
      shop.items.push(item);
    }
    if (c.kind === 'price') item.price ??= { seen: c.seenPrice, current: c.currentPrice };
    else item.stock ??= { qty: c.qty, left: c.stock };
  }
  const rank = (id: string) => { const i = shopOrder.indexOf(id); return i === -1 ? shopOrder.length : i; };
  return [...shops.values()].sort((a, b) => rank(a.shopId) - rank(b.shopId));
}

const yuan = (n: number) => `${n.toLocaleString('zh-TW')} 元`;

/** 漲跌只用文字標，顏色只是加強 */
export const priceTrend = (p: { seen: number; current: number }) => (p.current < p.seen ? '降價' : '漲價');

/** 庫存那一段的文字（失敗畫面）：已售完，或「你要買 N 件，」＋「只剩 M 件」 */
export const stockParts = (s: { qty: number; left: number }): [string, string] | ['', string] =>
  s.left <= 0 ? ['', '已售完'] : [`你要買 ${s.qty} 件，`, `只剩 ${s.left} 件`];

/**
 * 品項連結的朗讀字串。數字讀「500 元」不讀「$500」（讀屏會唸成美元）；規格名空字串時省略規格
 */
export function itemAriaLabel(item: RejectedItem): string {
  const parts = [item.title];
  if (item.variantName) parts.push(`規格：${item.variantName}`);
  if (item.price) parts.push(`價格原本 ${yuan(item.price.seen)}`, `現在 ${yuan(item.price.current)}`, priceTrend(item.price));
  if (item.stock) parts.push(stockParts(item.stock).join(''));
  parts.push('查看商品頁');
  return parts.join('，');
}

/** 運費列的朗讀字串（視覺文字 aria-hidden） */
export const shippingAriaText = (shopName: string, s: { seen: number; current: number }) =>
  `${shopName}，運費原本 ${yuan(s.seen)}，現在 ${yuan(s.current)}`;

/** 失敗畫面帶回購物車的內容：問題清單，與這次送出結帳的品項（itemKey），購物車只預設勾選後者 */
export interface PriceCheck { changes: CheckoutRejection[]; submitted: string[] }
export type PriceCheckState = { priceCheck: PriceCheck };

/**
 * 主要按鈕（D-7a＝D）：直接購買回第一件有問題的商品頁（只有運費變動時回這次買的那件）；
 * 購物車來的回購物車，並把問題清單放進這次導覽的 state 供購物車標示
 */
export function primaryAction(
  changes: CheckoutRejection[],
  { fromCart, submittedProductIds, submittedKeys }: { fromCart: boolean; submittedProductIds: string[]; submittedKeys: string[] },
): { label: string; to: string; state?: PriceCheckState } {
  if (fromCart) return { label: '回購物車重新結帳', to: '/cart', state: { priceCheck: { changes, submitted: submittedKeys } } };
  const first = changes.find(c => c.kind !== 'shipping');
  const productId = first ? first.productId : submittedProductIds[0];
  return { label: '回商品頁重新購買', to: productId ? `/product/${productId}` : '/' };
}

// ── 下單回傳 ──

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;
const isStr = (v: unknown): v is string => typeof v === 'string';
const isInt = (v: unknown): v is number => Number.isInteger(v);

function toRejection(v: unknown): CheckoutRejection | null {
  if (!isObj(v) || !isStr(v.shopId)) return null;
  if (v.kind === 'shipping') {
    return isStr(v.shopName) && isInt(v.seenFee) && isInt(v.currentFee)
      ? { kind: 'shipping', shopId: v.shopId, shopName: v.shopName, seenFee: v.seenFee, currentFee: v.currentFee } : null;
  }
  if (!isStr(v.productId) || !isStr(v.variantId) || !isStr(v.title) || !isStr(v.variantName)) return null;
  const base = { productId: v.productId, variantId: v.variantId, shopId: v.shopId, title: v.title, variantName: v.variantName };
  if (v.kind === 'price') return isInt(v.seenPrice) && isInt(v.currentPrice) ? { kind: 'price', ...base, seenPrice: v.seenPrice, currentPrice: v.currentPrice } : null;
  if (v.kind === 'stock') return isInt(v.qty) && isInt(v.stock) ? { kind: 'stock', ...base, qty: v.qty, stock: v.stock } : null;
  return null;
}

export type CheckedOrderResult<T> = { outcome: 'ok'; orders: T[] } | { outcome: 'rejected'; changes: CheckoutRejection[] };

/**
 * 下單回傳的唯一入口。看不懂的回傳、或「被擋卻沒有任何問題」一律丟錯（沒有資料庫代碼 → 畫面用通用的「下單失敗，請再試一次」），
 * 不能當成成立，也不能顯示空的失敗畫面
 */
export function parseCheckedOrder<T>(raw: unknown): CheckedOrderResult<T> {
  if (isObj(raw) && raw.outcome === 'ok' && Array.isArray(raw.orders)) return { outcome: 'ok', orders: raw.orders as T[] };
  if (isObj(raw) && raw.outcome === 'rejected' && Array.isArray(raw.changes)) {
    const changes = raw.changes.map(toRejection).filter((c): c is CheckoutRejection => c !== null);
    if (changes.length > 0) return { outcome: 'rejected', changes };
  }
  throw new AccountError('unexpected place_checked_order response', 'server', null);
}

// ── 購物車標示 ──

/** 購物車從 location.state 讀失敗畫面帶回來的內容；不是從失敗畫面來的（或格式不對）回 null */
export function readPriceCheckState(state: unknown): PriceCheck | null {
  if (!isObj(state) || !isObj(state.priceCheck)) return null;
  const { changes: rawChanges, submitted } = state.priceCheck;
  if (!Array.isArray(rawChanges) || !Array.isArray(submitted) || !submitted.every(isStr)) return null;
  const changes = rawChanges.map(toRejection).filter((c): c is CheckoutRejection => c !== null);
  return changes.length > 0 ? { changes, submitted } : null;
}

/**
 * 購物車的預設勾選：一般進頁全部勾選；從失敗畫面回來只勾這次送出結帳的品項，
 * 結帳前沒勾的維持沒勾（不能讓買家不細看就多買，B-1）
 */
export const defaultSelected = (keys: string[], priceCheck: PriceCheck | null): string[] =>
  priceCheck ? keys.filter(k => priceCheck.submitted.includes(k)) : keys;

export interface CartMarks {
  /** 鍵＝itemKey。price＝價格變動的文字；stock＝被標庫存不足（顯示與否看 cartStockNote） */
  items: Map<string, { price: string | null; stock: boolean }>;
  /** 鍵＝shopId，值＝運費變動的文字 */
  shops: Map<string, string>;
}

export function cartMarks(changes: CheckoutRejection[]): CartMarks {
  const items: CartMarks['items'] = new Map();
  const shops: CartMarks['shops'] = new Map();
  for (const c of changes) {
    if (c.kind === 'shipping') {
      if (!shops.has(c.shopId)) shops.set(c.shopId, `這家店的運費已變動：原本 ${money(c.seenFee)}，現在 ${money(c.currentFee)}`);
      continue;
    }
    const mark = items.get(itemKey(c)) ?? { price: null, stock: false };
    if (c.kind === 'price') mark.price ??= `價格已變動：原本 ${money(c.seenPrice)}，現在 ${money(c.currentPrice)}`;
    else mark.stock = true;
    items.set(itemKey(c), mark);
  }
  return { items, shops };
}

/**
 * 「只剩 N 件，請調整數量」：N 用重讀後的目前庫存。數量改到 N 以內就隱藏（U-5）；
 * 已售完沿用現有「此規格已售完」，不重複顯示
 */
export const cartStockNote = (marked: boolean, qty: number, stock: number): string | null =>
  marked && stock > 0 && qty > stock ? `只剩 ${stock} 件，請調整數量` : null;
