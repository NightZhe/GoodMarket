/** 賣家商品表單「規格與庫存」的驗證；只看字串輸入，不碰畫面 */

export interface VariantInput { name: string; price: string; original: string; stock: string }

/** 售價與原價的上限（與蝦皮匯入的 PRICE_MAX 一致） */
export const PRICE_MAX = 499_999;
/** 庫存上限 */
export const STOCK_MAX = 999_999;
/** 兩個上限都是 6 位數，輸入框最多收 6 個字 */
export const NUMBER_INPUT_MAX_LENGTH = 6;

const thousands = (n: number) => n.toLocaleString('en-US');

/** 只接受純數字字串；其他一律 NaN */
export const wholeNumber = (s: string) => (/^\d+$/.test(s.trim()) ? Number(s) : NaN);

export const REQUIRED_MSG = '每個規格都要填名稱、大於 0 的售價，以及 0 以上的庫存';
export const ORIGINAL_MSG = '原價要高於同一列的售價，否則請留空';
export const PRICE_MAX_MSG = `售價最高 $${thousands(PRICE_MAX)}`;
export const ORIGINAL_MAX_MSG = `原價最高 $${thousands(PRICE_MAX)}`;
export const STOCK_MAX_MSG = `庫存最高 ${thousands(STOCK_MAX)}`;

/** 回傳要顯示的錯誤訊息（不重複、固定順序）；空陣列代表可以送出 */
export function variantErrors(rows: VariantInput[]): string[] {
  const errors: string[] = [];
  const some = (test: (v: VariantInput) => boolean, msg: string) => { if (rows.some(test)) errors.push(msg); };

  some(v => !v.name.trim() || !(wholeNumber(v.price) > 0) || Number.isNaN(wholeNumber(v.stock)), REQUIRED_MSG);
  some(v => wholeNumber(v.price) > PRICE_MAX, PRICE_MAX_MSG);
  // 原價只有在填了、而且沒有超過上限時才拿來跟售價比；超過上限的只報上限
  some(v => v.original !== '' && wholeNumber(v.original) > PRICE_MAX, ORIGINAL_MAX_MSG);
  some(v => v.original !== '' && !(wholeNumber(v.original) > PRICE_MAX) && !(wholeNumber(v.original) > wholeNumber(v.price)), ORIGINAL_MSG);
  some(v => wholeNumber(v.stock) > STOCK_MAX, STOCK_MAX_MSG);
  return errors;
}

/** 快改（列表上的單格編輯）沒有名稱欄、價格與庫存分開存，所以用單欄的訊息，不用整列的 REQUIRED_MSG */
export const PRICE_REQUIRED_MSG = '請填大於 0 的售價';
export const STOCK_REQUIRED_MSG = '請填庫存（0 以上的整數）';
/** 訊息結尾的這兩個字，畫面上要做成連到編輯頁的連結 */
export const EDIT_PAGE_LINK_TEXT = '編輯頁';
export const belowOriginalMsg = (originalPrice: number) =>
  `售價要低於原價 $${thousands(originalPrice)}。要改原價請到${EDIT_PAGE_LINK_TEXT}`;

/**
 * 快改單一規格的售價檢查：回傳第一則錯誤（必填 → 上限 → 低於原價），沒有錯回 null。
 * 有原價（> 0）時新售價要低於原價，等於也擋；沒有原價（不存在或 0）就只受上限限制。
 */
export function quickPriceError(price: string, originalPrice?: number): string | null {
  const n = wholeNumber(price);
  if (!(n > 0)) return PRICE_REQUIRED_MSG;
  if (n > PRICE_MAX) return PRICE_MAX_MSG;
  if (originalPrice !== undefined && originalPrice > 0 && n >= originalPrice) return belowOriginalMsg(originalPrice);
  return null;
}

/** 快改單一規格的庫存檢查：0 到上限的整數 */
export function quickStockError(stock: string): string | null {
  const n = wholeNumber(stock);
  if (Number.isNaN(n)) return STOCK_REQUIRED_MSG;
  if (n > STOCK_MAX) return STOCK_MAX_MSG;
  return null;
}
