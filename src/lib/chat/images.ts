// 聊天圖片：選取時的篩檢（純函式）與壓縮。上限：原圖 20MB、壓縮後 5MB、一則 5 張（R-M8、D17）。
import { MAX_SOURCE_BYTES, compressPhoto, planIntake, type PickedFile } from '../reviews/photos';

export const MAX_CHAT_PHOTOS = 5;
export const MAX_CHAT_UPLOAD_BYTES = 5 * 1024 * 1024;
/** 聊天圖片長邊（評價是 1280）：店家要看得清瑕疵與型號 */
export const CHAT_MAX_EDGE = 2048;
const CHAT_QUALITIES = [0.85, 0.75, 0.65, 0.55, 0.45] as const;

export interface ChatIntake {
  /** 收下的檔案（原陣列的索引，維持選取順序） */
  accepted: number[];
  /** 要給使用者看的一行錯誤；沒有問題是 null */
  error: string | null;
}

/** 一次選多張：不是圖片、超過 20MB 的拒絕；其餘依剩餘名額收前面幾張。同時有多種問題時只說最先的那個（不是圖片 ＞ 太大 ＞ 張數） */
export function planChatIntake(files: PickedFile[], currentCount: number): ChatIntake {
  const plan = planIntake(files, currentCount, MAX_CHAT_PHOTOS);
  const error = plan.notImage.length > 0 ? '請選擇圖片檔'
    : plan.tooBig.length > 0 ? `圖片檔案太大（上限 ${MAX_SOURCE_BYTES / 1024 / 1024}MB）`
    : plan.overflow > 0 ? `圖片最多 ${MAX_CHAT_PHOTOS} 張`
    : null;
  return { accepted: plan.accepted, error };
}

/** 壓縮後仍超過 5MB 就擋（Storage 也以 5MB 為硬上限） */
export function compressedPhotoError(bytes: number): string | null {
  return bytes > MAX_CHAT_UPLOAD_BYTES ? '單張圖片不能超過 5MB' : null;
}

/** 長邊 ≤ 2048、JPEG、方向轉正、不帶 EXIF（含 GPS）。可能仍大於 5MB，呼叫端要再用 compressedPhotoError 檢查 */
export const compressChatPhoto = (file: Blob): Promise<Blob> =>
  compressPhoto(file, { maxEdge: CHAT_MAX_EDGE, maxBytes: MAX_CHAT_UPLOAD_BYTES, qualities: CHAT_QUALITIES });
