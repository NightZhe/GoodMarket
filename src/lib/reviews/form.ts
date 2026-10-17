import { codePointLength } from './nickname';
import { MAX_CONTENT } from './types';

// 評價表單的送出條件。全部是純函式：畫面只負責把狀態餵進來、把結果顯示出去。

export type PhotoStatus = 'processing' | 'uploading' | 'done' | 'failed' | 'unusable';

export interface EditorItem {
  productId: string;
  rating: number;
  content: string;
  photos: { status: PhotoStatus }[];
}

/** 送出給資料庫的文字：頭尾空白去掉（資料庫也會去），長度以 code point 計 */
export const trimmedContent = (s: string) => s.replace(/^[\s　 ]+|[\s　 ]+$/g, '');
export const contentLength = (s: string) => codePointLength(trimmedContent(s));
export const isContentTooLong = (s: string) => contentLength(s) > MAX_CONTENT;

/** 沒打星等的商品不會送出，所以它的文字與照片都不影響能不能送 */
export const ratedItems = <T extends { rating: number }>(items: T[]) => items.filter(i => i.rating > 0);

export type BlockerTarget = { type: 'item'; productId: string } | { type: 'nickname' };

export interface Blocker {
  kind: 'noRating' | 'uploading' | 'failed' | 'tooLong' | 'nickname';
  message: string;
  target: BlockerTarget | null;
}

/** 說明文字的優先順序（design S-2）：只回第一個符合的；null＝可以送出 */
export function submitBlocker(items: EditorItem[], nicknameValid: boolean): Blocker | null {
  const rated = ratedItems(items);
  if (rated.length === 0) {
    return { kind: 'noRating', message: '請至少替一件商品打星等', target: items[0] ? { type: 'item', productId: items[0].productId } : null };
  }
  const busy = rated.find(i => i.photos.some(p => p.status === 'processing' || p.status === 'uploading'));
  if (busy) return { kind: 'uploading', message: '照片上傳中，完成後才能送出', target: { type: 'item', productId: busy.productId } };
  const failed = rated.find(i => i.photos.some(p => p.status === 'failed' || p.status === 'unusable'));
  if (failed) return { kind: 'failed', message: '有照片上傳失敗，請重試或刪除後再送出', target: { type: 'item', productId: failed.productId } };
  const long = rated.find(i => isContentTooLong(i.content));
  if (long) {
    const n = items.findIndex(i => i.productId === long.productId) + 1;
    return { kind: 'tooLong', message: `第 ${n} 件商品的評價內容超過 500 字`, target: { type: 'item', productId: long.productId } };
  }
  if (!nicknameValid) return { kind: 'nickname', message: '暱稱格式不正確，請修改後再送出', target: { type: 'nickname' } };
  return null;
}

export const readyMessage = (count: number) => `將送出 ${count} 件商品的評價`;

/** 送出前確認的第一行 */
export const confirmSummary = (items: number, photos: number) =>
  `將送出 ${items} 件商品的評價${photos > 0 ? `，共 ${photos} 張照片` : ''}。`;

/** 組出 submit_account_reviews 的 p_items：只送有打星等的商品；照片只送已上傳成功的路徑 */
export function buildSubmitItems(
  items: { productId: string; rating: number; content: string; photos: { status: PhotoStatus; path?: string }[] }[],
) {
  return ratedItems(items).map(i => ({
    productId: i.productId,
    rating: i.rating,
    content: trimmedContent(i.content),
    photos: i.photos.filter(p => p.status === 'done' && p.path).map(p => p.path as string),
  }));
}
