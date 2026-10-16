// 評價表單草稿（decisions.md 主對話裁示）：
// Safari 從相機或圖庫回來時，頁面可能被系統丟掉重新載入，填好的內容會整個消失。
// 星等、文字、暱稱、「已上傳成功」的照片路徑存在 sessionStorage；送出成功或確認離開後清除。
// 照片檔案本身不存（太大），只存路徑——路徑指向的是已經在 Storage 的檔案，所以重新載入後縮圖還在。

export interface DraftPhoto { path: string; expiresAt: string }
export interface DraftItem { rating: number; content: string; photos: DraftPhoto[] }
export interface Draft { nickname: string; items: Record<string, DraftItem> }

export const draftKey = (orderId: string) => `goodmarket_review_draft:${orderId}`;

/** 上傳位置快過期（不到 60 秒）的照片，送出時多半已經失效，還原時就不算數 */
export const SLOT_MARGIN_MS = 60_000;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** 讀回來的資料一律當作不可信：格式不對的欄位丟掉，不要讓壞資料把表單弄壞 */
export function parseDraft(raw: string | null): Draft | null {
  if (!raw) return null;
  let data: unknown;
  try { data = JSON.parse(raw); } catch { return null; }
  if (!isObj(data) || !isObj(data.items)) return null;
  const items: Record<string, DraftItem> = {};
  for (const [id, v] of Object.entries(data.items)) {
    if (!isObj(v)) continue;
    const rating = typeof v.rating === 'number' && Number.isInteger(v.rating) && v.rating >= 0 && v.rating <= 5 ? v.rating : 0;
    const content = typeof v.content === 'string' ? v.content : '';
    const photos = Array.isArray(v.photos)
      ? v.photos.filter((p): p is DraftPhoto => isObj(p) && typeof p.path === 'string' && typeof p.expiresAt === 'string')
          .map(p => ({ path: p.path, expiresAt: p.expiresAt }))
      : [];
    items[id] = { rating, content, photos };
  }
  return { nickname: typeof data.nickname === 'string' ? data.nickname : '', items };
}

export function hasInput(d: Draft): boolean {
  return d.nickname.trim() !== '' || Object.values(d.items).some(i => i.rating > 0 || i.content.trim() !== '' || i.photos.length > 0);
}

/** 還原照片：只留上傳位置還有效的，其餘回報丟了幾張（畫面提示「需要重新選取」） */
export function splitUsablePhotos(photos: DraftPhoto[], now: number): { kept: DraftPhoto[]; dropped: number } {
  const kept = photos.filter(p => Date.parse(p.expiresAt) - now > SLOT_MARGIN_MS);
  return { kept, dropped: photos.length - kept.length };
}
