/** 「我的商品」列表快改：呼叫 quick_edit_product 的型別、失敗分類與文案；只有純函式，不碰畫面 */
import { money } from '../format';
import type { RpcErrorLike } from '../import/errors';
import {
  PRICE_MAX_MSG, PRICE_REQUIRED_MSG, STOCK_MAX_MSG, STOCK_REQUIRED_MSG, belowOriginalMsg,
  quickPriceError, quickStockError, wholeNumber,
} from './variants';
import type { Variant } from '../../types';

export type QuickField = 'price' | 'stock';

/** 欄位名稱：格子、群組名稱、離開確認、讀屏用「價格」；輸入框旁的標籤用「售價」（design 第 5 節） */
export const FIELD_NAME: Record<QuickField, string> = { price: '價格', stock: '庫存' };
export const INPUT_LABEL: Record<QuickField, string> = { price: '售價', stock: '庫存' };
/** 手機面板價格與庫存一起改 */
export const BOTH_FIELDS_NAME = '價格與庫存';

/** quick_edit_product 的 p_changes 一筆：只放這次有改的值；expected 是賣家開始改時看到的值。快改一律不送 original_price */
export interface QuickChange {
  variantId: string;
  field: QuickField;
  expected: number;
  value: number;
}

export interface QuickConflict {
  variantId: string;
  variantName: string;
  field: 'price' | 'original_price' | 'stock';
  seen: number | null;
  current: number | null;
  attempted: number | null;
}

export interface QuickInvalid {
  code: string;
  variantId: string;
  field: string;
  message: string;
  /** ORIGINAL_NOT_ABOVE_PRICE 才有：資料庫目前的原價 */
  originalPrice?: number;
  price?: number;
}

export interface QuickEditOk {
  outcome: 'ok';
  productId: string;
  status: 'active' | 'hidden';
  autoHidden: boolean;
  variants: Variant[];
  changed: { variantId: string; field: string; old: number | null; new: number | null }[];
}
export interface QuickEditConflict {
  outcome: 'conflict';
  productId: string;
  status: 'active' | 'hidden';
  variants: Variant[];
  conflicts: QuickConflict[];
}
export interface QuickEditInvalid { outcome: 'invalid'; errors: QuickInvalid[] }
export type QuickEditResult = QuickEditOk | QuickEditConflict | QuickEditInvalid;

export type QuickEditFailureKind = 'network' | 'timeout' | 'server' | 'auth' | 'not_found' | 'variant_missing';

/** 呼叫層失敗（網路、逾時、資料庫丟的錯誤碼）；outcome 為 conflict／invalid 不是失敗 */
export class QuickEditError extends Error {
  readonly kind: QuickEditFailureKind;
  constructor(kind: QuickEditFailureKind, message: string) {
    super(message);
    this.name = 'QuickEditError';
    this.kind = kind;
  }
}

/** 輸入框與錯誤訊息對應用的鍵 */
export const fieldKey = (variantId: string, field: QuickField) => `${variantId}:${field}`;

const BIG_DROP = 0.5;
const BIG_RISE = 2;

/** 大幅改價（D-9）：降 50% 以上或漲 100% 以上。用實際比值判斷，百分比只是顯示用 */
export function bigPriceChange(from: number, to: number): { kind: 'drop' | 'rise'; percent: number } | null {
  if (!(from > 0) || to === from) return null;
  if (to <= from * BIG_DROP) return { kind: 'drop', percent: Math.round((1 - to / from) * 100) };
  if (to >= from * BIG_RISE) return { kind: 'rise', percent: Math.round((to / from - 1) * 100) };
  return null;
}

export const bigChangeLine = (from: number, to: number, c: { kind: 'drop' | 'rise'; percent: number }) =>
  `從 ${money(from)} 改成 ${money(to)}（${c.kind === 'drop' ? '降' : '漲'} ${c.percent}%）`;

/** 登入失效的 PostgREST 代碼：PGRST301～303＝JWT 失效，42501＝沒有權限（同 lib/account/errors） */
const AUTH_CODES = ['PGRST301', 'PGRST302', 'PGRST303', '42501'];

/**
 * 把 supabase-js 回的錯誤分類。hint 是資料庫丟的代碼；沒有 code 也沒有 hint＝沒有伺服器回應（網路）；
 * 其餘（含函式不存在的 PGRST202）一律當伺服器問題。
 */
export function toQuickEditFailure(err: RpcErrorLike, timedOut: boolean): QuickEditFailureKind {
  if (timedOut) return 'timeout';
  const hint = err.hint || null;
  const code = err.code || null;
  switch (hint) {
    case 'NOT_AUTHENTICATED': return 'auth';
    case 'PRODUCT_NOT_FOUND': return 'not_found';
    case 'VARIANT_NOT_FOUND': return 'variant_missing';
  }
  if (code !== null && AUTH_CODES.includes(code)) return 'auth';
  if (!code && !hint) return 'network';
  return 'server';
}

const FAILURE_REASON: Record<'network' | 'timeout' | 'server', string> = {
  network: '連不上網路', timeout: '伺服器沒有回應', server: '伺服器發生問題',
};

export const failureText = (kind: QuickEditFailureKind) =>
  kind === 'auth'
    ? '沒有存成功：登入已過期，請重新登入。'
    : `沒有存成功：${FAILURE_REASON[kind === 'network' || kind === 'timeout' ? kind : 'server']}。你填的內容還在。`;

/**
 * 伺服器回 invalid：把每筆錯誤標到對應的輸入框。快改沒有原價欄，ORIGINAL_NOT_ABOVE_PRICE 標在售價旁，
 * 金額用伺服器回的原價。有任何一筆標不上輸入框（快改不會送的原價欄位）就回 null，由呼叫端顯示通用失敗。
 */
export function invalidToErrors(errors: QuickInvalid[]): Record<string, string> | null {
  const out: Record<string, string> = {};
  for (const e of errors) {
    switch (e.code) {
      case 'PRICE_INVALID': out[fieldKey(e.variantId, 'price')] = PRICE_REQUIRED_MSG; break;
      case 'PRICE_TOO_HIGH': out[fieldKey(e.variantId, 'price')] = PRICE_MAX_MSG; break;
      case 'STOCK_INVALID': out[fieldKey(e.variantId, 'stock')] = STOCK_REQUIRED_MSG; break;
      case 'STOCK_TOO_HIGH': out[fieldKey(e.variantId, 'stock')] = STOCK_MAX_MSG; break;
      case 'ORIGINAL_NOT_ABOVE_PRICE':
        if (typeof e.originalPrice !== 'number') return null;
        out[fieldKey(e.variantId, 'price')] = belowOriginalMsg(e.originalPrice);
        break;
      default: return null;
    }
  }
  return Object.keys(out).length > 0 ? out : null;
}

export interface NoticeInput {
  autoHidden: boolean;
  status: 'active' | 'hidden';
  /** 這次有實際改到庫存 */
  stockChanged: boolean;
  /** 改完全部規格的庫存加總 */
  stockTotal: number;
  /** 存完這列離開了目前的分頁籤，要搬去哪（'active' | 'soldout' | 'hidden'）；還在就 null */
  leftTab: string | null;
}

export const AUTO_HIDDEN_TEXT = '已更新，庫存為 0，已自動下架';
export const STILL_HIDDEN_TEXT = '已更新。商品仍是下架狀態，要賣請按上架';

/** plain＝一般成功；warn＝要賣家注意商品是下架的（自動下架、仍是下架） */
export function resultNotice(i: NoticeInput): { kind: 'plain' | 'warn'; text: string } {
  if (i.autoHidden) return { kind: 'warn', text: AUTO_HIDDEN_TEXT };
  const stillHidden = i.status === 'hidden' && i.stockChanged && i.stockTotal > 0;
  if (i.leftTab !== null) {
    // 唯一會走到這裡的是在「已售完」補貨：商品上架就進「架上商品」，下架就進「已下架」
    return stillHidden
      ? { kind: 'warn', text: `${STILL_HIDDEN_TEXT}（已移到「已下架」）` }
      : { kind: 'plain', text: '已更新，這件商品移到了「架上商品」' };
  }
  return stillHidden ? { kind: 'warn', text: STILL_HIDDEN_TEXT } : { kind: 'plain', text: '已更新' };
}

const valueText = (field: QuickConflict['field'], n: number | null) =>
  n === null ? '無' : field === 'stock' ? String(n) : money(n);

/** 多規格衝突的一行明細（規格名稱由畫面放在前面） */
export const conflictDetail = (c: Pick<QuickConflict, 'field' | 'seen' | 'current' | 'attempted'>) =>
  `${c.field === 'stock' ? '庫存' : '售價'}　你看到 ${valueText(c.field, c.seen)} → 現在 ${valueText(c.field, c.current)}（你填 ${valueText(c.field, c.attempted)}）`;

export const bigChangeArrow = (from: number, to: number, c: { kind: 'drop' | 'rise'; percent: number }) =>
  `${money(from)} → ${money(to)}（${c.kind === 'drop' ? '降' : '漲'} ${c.percent}%）`;

/** 單規格、只有一個值衝突時的整句說明 */
export const conflictSentence = (c: Pick<QuickConflict, 'field' | 'seen' | 'current' | 'attempted'>) =>
  c.field === 'stock'
    ? `庫存已從 ${valueText('stock', c.seen)} 變成 ${valueText('stock', c.current)}，可能是這段時間有人下單。你填的是 ${valueText('stock', c.attempted)}。`
    : `售價已從 ${valueText('price', c.seen)} 變成 ${valueText('price', c.current)}，可能是在別的視窗改過。你填的是 ${valueText('price', c.attempted)}。`;

/** 編輯區開始時的規格快照：seen 是賣家看到的值（送出時的 expected） */
export interface QuickRow {
  id: string;
  name: string;
  originalPrice?: number;
  seen: Record<QuickField, number>;
}
export interface ConfirmLine { variantId: string; name: string; text: string }

/**
 * 依目前草稿算出這次要送的值、驗證錯誤、需要確認的大幅改價。
 * 沒改的值不驗也不送（R-3、R-5）；只看這個編輯區能改的欄位。
 */
export function collectQuickEdit(
  rows: QuickRow[],
  drafts: Record<string, Record<QuickField, string>>,
  fields: QuickField[],
): { errs: Record<string, string>; changes: QuickChange[]; big: ConfirmLine[] } {
  const errs: Record<string, string> = {};
  const changes: QuickChange[] = [];
  const big: ConfirmLine[] = [];
  for (const r of rows) {
    for (const f of fields) {
      const draft = drafts[r.id]?.[f] ?? '';
      if (wholeNumber(draft) === r.seen[f]) continue;
      const msg = fieldError(r, f, draft);
      if (msg) { errs[fieldKey(r.id, f)] = msg; continue; }
      const value = wholeNumber(draft);
      changes.push({ variantId: r.id, field: f, expected: r.seen[f], value });
      const c = f === 'price' ? bigPriceChange(r.seen.price, value) : null;
      if (c) {
        big.push({
          variantId: r.id,
          name: r.name,
          text: rows.length === 1 ? `售價${bigChangeLine(r.seen.price, value, c)}` : bigChangeArrow(r.seen.price, value, c),
        });
      }
    }
  }
  return { errs, changes, big };
}

/** 單一欄位的草稿錯誤；跟開始時的值一樣就不檢查（匯入的超大庫存不能卡住） */
export const fieldError = (row: QuickRow, field: QuickField, draft: string): string | null =>
  wholeNumber(draft) === row.seen[field]
    ? null
    : field === 'price' ? quickPriceError(draft, row.originalPrice) : quickStockError(draft);

/** 這組要送的值的指紋：確認過的是「這一組值」，值一變就要重新確認（spec 5.7） */
export const changesKey = (changes: QuickChange[]) =>
  changes.map(c => `${c.variantId}:${c.field}:${c.value}`).join('|');

export const needsConfirm = (big: ConfirmLine[], key: string, confirmedKey: string | null) =>
  big.length > 0 && key !== confirmedKey;

/**
 * 回 conflict，但每一筆都是「現在的值就是我要寫的值」：代表前一次送出其實已經寫入（逾時才會這樣），
 * 當成功處理（interface.md 第 4 節）。wasActive＝送出前商品是上架中，用來推算有沒有被自動下架。
 * 衝突沒有涵蓋全部 changes（有些值沒被寫入）就不算。
 */
export function settleConflict(res: QuickEditConflict, changes: QuickChange[], wasActive: boolean): QuickEditOk | null {
  if (res.conflicts.length !== changes.length) return null;
  const settled = changes.every(c => res.conflicts.some(k =>
    k.variantId === c.variantId && k.field === c.field && k.current === c.value && k.attempted === c.value));
  if (!settled) return null;
  return {
    outcome: 'ok',
    productId: res.productId,
    status: res.status,
    autoHidden: wasActive && res.status === 'hidden' && changes.some(c => c.field === 'stock') && res.variants.every(v => v.stock === 0),
    variants: res.variants,
    changed: res.conflicts.map(k => ({ variantId: k.variantId, field: k.field, old: k.seen, new: k.current })),
  };
}
