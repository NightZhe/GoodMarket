import type { Product } from '../../types';
import type { PendingAction } from './pending';
import { isExpired } from './pending';

// D14：登入完回到商品頁，要自動完成原本的動作。不能完成時一律「不執行」，停在商品頁、說明原因、保留選擇。
// 這裡把「能不能執行」與「要對使用者說什麼」都做成純函式（S-4 的七種情況），畫面只負責顯示。

export type AutoMode = 'cart' | 'buy';

export type AutoReason =
  | 'expired'            // 超過 60 分鐘
  | 'unavailable'        // 商品下架或不存在
  | 'own_shop'           // 自己商店的商品（D12）
  | 'variant_missing'    // 規格已不存在
  | 'sold_out'           // 規格已售完
  | 'insufficient_stock' // 庫存比選的數量少
  | 'failed';            // 動作本身失敗（網路、伺服器）

export interface AutoDetail { variantName?: string; stock?: number; qty?: number; shopName?: string }

export type AutoCheck = { ok: true } | ({ ok: false; reason: Exclude<AutoReason, 'failed'> } & AutoDetail);

type Action = Extract<PendingAction, { kind: 'add_to_cart' | 'buy_now' }>;

export const autoModeOf = (a: Pick<Action, 'kind'>): AutoMode => (a.kind === 'add_to_cart' ? 'cart' : 'buy');

export function checkAutoAction(args: {
  action: Action;
  now: number;
  product: Product | undefined;
  /** 目前帳號開的店；還沒載入或沒開店是 null */
  myShopId: string | null;
  shopName?: string;
}): AutoCheck {
  const { action, now, product, myShopId, shopName } = args;
  if (isExpired(action, now)) return { ok: false, reason: 'expired' };
  if (!product || product.status !== 'active') return { ok: false, reason: 'unavailable' };
  if (myShopId && myShopId === product.shopId) return { ok: false, reason: 'own_shop', shopName };
  const variant = product.variants.find(v => v.id === action.variantId);
  if (!variant) return { ok: false, reason: 'variant_missing' };
  if (variant.stock <= 0) return { ok: false, reason: 'sold_out', variantName: variant.name };
  if (action.qty > variant.stock) {
    return { ok: false, reason: 'insufficient_stock', variantName: variant.name, stock: variant.stock, qty: action.qty };
  }
  return { ok: true };
}

/** 資料庫的錯誤碼（error.hint）→ 同一組原因，讓「前端預檢沒擋到、資料庫擋下」的情況也走同一套說明 */
export function reasonFromDbCode(code: string | null): Exclude<AutoReason, 'failed' | 'expired' | 'insufficient_stock'> | null {
  switch (code) {
    case 'PRODUCT_UNAVAILABLE': return 'unavailable';
    case 'VARIANT_NOT_FOUND': return 'variant_missing';
    case 'OUT_OF_STOCK': return 'sold_out';
    case 'OWN_SHOP': return 'own_shop';
    default: return null;
  }
}

export type NoticeKind = 'info' | 'warning' | 'error';

export interface AutoNoticeText { kind: NoticeKind; title: string; body: string }

/** S-4：沒執行的原因對應的橫幅文字（逐字照設計文案） */
export function autoNoticeText(mode: AutoMode, reason: AutoReason, d: AutoDetail = {}): AutoNoticeText {
  const didNot = mode === 'cart' ? '沒有加入購物車' : '沒有進入結帳';
  const verb = mode === 'cart' ? '加入' : '購買';
  switch (reason) {
    case 'variant_missing':
      return { kind: 'warning', title: didNot, body: '你選的規格已經不存在，請重新選擇規格。' };
    case 'insufficient_stock':
      return {
        kind: 'warning', title: didNot,
        body: `「${d.variantName ?? ''}」目前只剩 ${d.stock ?? 0} 件，你選了 ${d.qty ?? 0} 件。請調整數量後再${verb}。`,
      };
    case 'sold_out':
      return { kind: 'warning', title: didNot, body: `「${d.variantName ?? ''}」已經售完了，請改選其他規格。` };
    case 'own_shop':
      return {
        kind: 'info', title: '不能購買自己商店的商品',
        body: d.shopName ? `你登入的帳號是「${d.shopName}」的店主，所以${didNot}。` : `你登入的帳號是這家商店的店主，所以${didNot}。`,
      };
    case 'expired':
      return {
        kind: 'info',
        title: mode === 'cart' ? '登入花了比較久，沒有自動加入購物車' : '登入花了比較久，沒有自動進入結帳',
        body: `為了避免誤加，請確認你的選擇後，再按一次「${mode === 'cart' ? '加入購物車' : '直接購買'}」。`,
      };
    case 'unavailable':
      return {
        kind: 'warning',
        title: mode === 'cart' ? '商品已下架，沒有加入購物車' : '商品已下架，沒有進入結帳',
        body: '你可以回首頁看看其他商品。',
      };
    case 'failed':
      return {
        kind: 'error',
        title: mode === 'cart' ? '加入購物車失敗' : '前往結帳失敗',
        body: '網路好像不太穩。你的選擇還在，再試一次。',
      };
  }
}
