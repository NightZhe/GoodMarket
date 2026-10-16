import { ReviewError } from './errors';
import { SLOT_MARGIN_MS } from './draft';
import type { PhotoStatus } from './form';
import type { UploadSlot } from './types';

/** 表單裡的一張照片（畫面狀態＋重試所需的資料） */
export interface PhotoItem {
  key: string;
  status: PhotoStatus;
  /** 縮圖來源：本機物件網址，或還原草稿時的公開網址 */
  src: string;
  /** 壓縮後的 JPEG；留在記憶體裡才能重試、也才能在上傳位置過期後重傳。從草稿還原的照片沒有 */
  blob?: Blob;
  path?: string;
  slot?: UploadSlot | null;
  failure?: UploadFailure;
}

// 單張照片的上傳流程：申請上傳位置 → 上傳 → 位置過期（403）就重新申請、重傳一次（AC-72）。
// 對外的依賴（RPC、Storage、時鐘）都由呼叫端注入，邏輯本身不碰網路，所以可以單元測試。

export type UploadFailure =
  | 'network'   // 網路或逾時：可以重試
  | 'expired'   // 重新申請後仍被拒絕：「照片上傳逾時」
  | 'limit'     // 累計申請上限：只能刪除
  | 'unusable'  // 伺服器拒絕檔案本身（過大、不是 JPEG）：只能刪除
  | 'fatal';    // 訂單狀態不允許（過期、已評價…）：由呼叫端處理

export type UploadResult =
  | { ok: true; path: string; slot: UploadSlot }
  | { ok: false; reason: UploadFailure; slot: UploadSlot | null; error?: ReviewError };

/** Storage 回應的狀態碼；supabase-js 的 StorageApiError 放在 status／statusCode（版本不同欄位不同） */
export class StorageUploadError extends Error {
  readonly status: number | null;
  constructor(message: string, status: number | null) {
    super(message);
    this.name = 'StorageUploadError';
    this.status = status;
  }
}

export interface UploadDeps {
  requestSlot: () => Promise<UploadSlot>;
  upload: (path: string, blob: Blob) => Promise<void>;
  now: () => number;
}

const slotUsable = (s: UploadSlot | null, now: number): s is UploadSlot =>
  s !== null && Date.parse(s.expires_at) - now > SLOT_MARGIN_MS;

async function tryUpload(slot: UploadSlot, blob: Blob, deps: UploadDeps): Promise<'ok' | UploadFailure> {
  try {
    await deps.upload(slot.path, blob);
    return 'ok';
  } catch (e) {
    const status = e instanceof StorageUploadError ? e.status : null;
    // 409：這個路徑已經有檔案。路徑是隨機的、只有我們拿得到，代表上一次其實傳成功了只是回應沒收到
    if (status === 409) return 'ok';
    if (status === 403) return 'expired';
    if (status === 413 || status === 415) return 'unusable';
    return 'network';
  }
}

export async function uploadPhoto(blob: Blob, current: UploadSlot | null, deps: UploadDeps): Promise<UploadResult> {
  let slot = current;

  let fatal: ReviewError | undefined;
  const request = async (): Promise<UploadFailure | null> => {
    try {
      slot = await deps.requestSlot();
      return null;
    } catch (e) {
      if (e instanceof ReviewError) {
        if (e.code === 'UPLOAD_LIMIT_EXCEEDED') return 'limit';
        if (e.code !== null) { fatal = e; return 'fatal'; }
      }
      return 'network';
    }
  };

  if (!slotUsable(slot, deps.now())) {
    const failed = await request();
    if (failed) return { ok: false, reason: failed, slot: null, error: fatal };
  }

  const first = await tryUpload(slot as UploadSlot, blob, deps);
  if (first === 'ok') return { ok: true, path: (slot as UploadSlot).path, slot: slot as UploadSlot };
  if (first !== 'expired') return { ok: false, reason: first, slot };

  // 403：位置已失效。重新申請一個，再傳一次；再失敗才回報逾時
  const failed = await request();
  if (failed) return { ok: false, reason: failed, slot: null, error: fatal };
  const second = await tryUpload(slot as UploadSlot, blob, deps);
  if (second === 'ok') return { ok: true, path: (slot as UploadSlot).path, slot: slot as UploadSlot };
  return { ok: false, reason: second, slot };
}

export const UPLOAD_FAILURE_TEXT: Record<UploadFailure, (n: number) => string> = {
  network: n => `第 ${n} 張照片上傳失敗，請點照片重試，或刪除這張。`,
  expired: () => '照片上傳逾時，請重新上傳',
  limit: () => '照片上傳次數已達上限，請刪除這張。',
  unusable: n => `第 ${n} 張照片的格式無法使用，請刪除這張。`,
  fatal: n => `第 ${n} 張照片上傳失敗，請點照片重試，或刪除這張。`,
};
