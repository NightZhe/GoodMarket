import { supabase } from '../supabase';
import { ReviewError, toErrorCode } from './errors';
import { StorageUploadError } from './upload';
import type {
  OrderReviewStatus, PublicReviewList, ReplyResult, ReviewSummaryData, SellerReviewCounts, SellerReviewList,
  SellerTab, SubmitItem, UploadSlot,
} from './types';

// 所有評價 RPC 的呼叫都集中在這裡：錯誤碼在 error.hint，轉成 ReviewError 往上丟。
// 網路中斷時 supabase-js 回的 error 沒有 hint → code 是 null，呼叫端據此當作「可重試」。

const BUCKET = 'review-images';

async function rpc<T>(fn: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw new ReviewError(error.message, toErrorCode(error.hint));
  return data as T;
}

export const getReviewSummary = () => rpc<ReviewSummaryData>('get_review_summary');

export const getMyReviewStatus = (keys: { id: string; token: string }[]) =>
  rpc<OrderReviewStatus[]>('get_my_review_status', { p_keys: keys });

export const requestReviewUpload = (orderId: string, token: string, productId: string, count: number) =>
  rpc<UploadSlot[]>('request_review_upload', { p_order_id: orderId, p_token: token, p_product_id: productId, p_count: count });

export const submitReviews = (orderId: string, token: string, nickname: string | null, items: SubmitItem[]) =>
  rpc<{ id: string; product_id: string }[]>('submit_reviews', {
    p_order_id: orderId, p_token: token, p_nickname: nickname, p_items: items,
  });

interface ListArgs { rating: number | null; withPhotos: boolean; limit: number; offset: number }

export const getProductReviews = (productId: string, a: ListArgs) =>
  rpc<PublicReviewList>('get_product_reviews', {
    p_product_id: productId, p_rating: a.rating, p_with_photos: a.withPhotos, p_limit: a.limit, p_offset: a.offset,
  });

export const getShopReviews = (shopId: string, a: ListArgs) =>
  rpc<PublicReviewList>('get_shop_reviews', {
    p_shop_id: shopId, p_rating: a.rating, p_with_photos: a.withPhotos, p_limit: a.limit, p_offset: a.offset,
  });

export const getSellerReviewCounts = () => rpc<SellerReviewCounts>('get_seller_review_counts');

export const getSellerReviews = (tab: SellerTab, rating: number | null, limit: number, offset: number) =>
  rpc<SellerReviewList>('get_seller_reviews', { p_tab: tab, p_rating: rating, p_limit: limit, p_offset: offset });

export const replyReview = (reviewId: string, reply: string) =>
  rpc<ReplyResult>('reply_review', { p_review_id: reviewId, p_reply: reply });

// ───────── Storage ─────────

/** 評價照片的公開網址（路徑是資料庫發的隨機 uuid，不含任何訂單資訊） */
export const reviewPhotoUrl = (path: string) => supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;

const UPLOAD_TIMEOUT_MS = 60_000;

/** 上傳一張已壓縮的照片到資料庫發的位置。不用 upsert；失敗時帶上 HTTP 狀態碼給 uploadPhoto 判斷 */
export async function uploadReviewPhoto(path: string, blob: Blob): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new StorageUploadError('上傳逾時', null)), UPLOAD_TIMEOUT_MS);
  });
  try {
    const { error } = await Promise.race([
      supabase.storage.from(BUCKET).upload(path, blob, { contentType: 'image/jpeg', upsert: false }),
      timeout,
    ]);
    if (error) {
      const e = error as { status?: number | string; statusCode?: number | string; message: string };
      const raw = e.statusCode ?? e.status;
      const status = raw === undefined ? null : Number(raw);
      throw new StorageUploadError(e.message, Number.isFinite(status) ? status : null);
    }
  } finally {
    clearTimeout(timer);
  }
}
