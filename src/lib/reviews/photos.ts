// 評價照片：選取時的篩檢（純函式，可測試）＋瀏覽器端壓縮。
// 壓縮沿用 src/lib/import/images.ts 的做法（createImageBitmap → canvas → JPEG，先鋪白底），
// 差別：長邊 1280px；解碼時依 EXIF 轉正方向。經過 canvas 重新編碼就不會帶 EXIF，包含 GPS 位置（R-17）。

import { MAX_PHOTOS } from './types';

export const MAX_SOURCE_BYTES = 20 * 1024 * 1024;
export const MAX_EDGE = 1280;
export const MAX_UPLOAD_BYTES = 2 * 1024 * 1024;
export const QUALITIES = [0.8, 0.7, 0.6, 0.5] as const;

export interface PickedFile { name: string; type: string; size: number }

const IMAGE_EXT = /\.(jpe?g|png|webp|gif|heic|heif|avif|bmp)$/i;

/** 有些瀏覽器選到 HEIC 時 type 是空字串，這時退而看副檔名 */
export const looksLikeImage = (f: PickedFile) => f.type.startsWith('image/') || (f.type === '' && IMAGE_EXT.test(f.name));

export interface IntakePlan {
  /** 收下的檔案（原陣列的索引，維持選取順序） */
  accepted: number[];
  notImage: string[];
  tooBig: string[];
  /** 有效但超出名額、沒收的張數 */
  overflow: number;
}

/** 一次選多張時的篩檢：不是圖片、超過 20 MB 的直接拒絕；其餘依剩餘名額收前面幾張（AC-63、AC-65） */
export function planIntake(files: PickedFile[], currentCount: number, max = MAX_PHOTOS): IntakePlan {
  const notImage: string[] = [];
  const tooBig: string[] = [];
  const valid: number[] = [];
  files.forEach((f, i) => {
    if (!looksLikeImage(f)) notImage.push(f.name);
    else if (f.size > MAX_SOURCE_BYTES) tooBig.push(f.name);
    else valid.push(i);
  });
  const room = Math.max(0, max - currentCount);
  return { accepted: valid.slice(0, room), notImage, tooBig, overflow: Math.max(0, valid.length - room) };
}

/** 選取後給使用者看的提示文字；沒有任何問題回 null（取消選取或全部成功時什麼都不顯示，R-20） */
export function intakeNotice(plan: IntakePlan): string | null {
  const lines: string[] = [];
  if (plan.overflow > 0) lines.push(`最多 ${MAX_PHOTOS} 張，已加入前 ${plan.accepted.length} 張`);
  const rejected = plan.notImage.length + plan.tooBig.length;
  if (rejected === 1) {
    lines.push(plan.notImage.length === 1 ? `「${plan.notImage[0]}」不是圖片，已略過` : `「${plan.tooBig[0]}」超過 20 MB，已略過`);
  } else if (rejected > 1) {
    lines.push(`有 ${rejected} 個檔案無法加入（不是圖片或超過 20 MB）`);
  }
  return lines.length > 0 ? lines.join('。') : null;
}

/** 長邊縮到 maxEdge 以內；比 maxEdge 小就不放大 */
export function fitWithin(width: number, height: number, maxEdge = MAX_EDGE): { width: number; height: number } {
  const scale = Math.min(1, maxEdge / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

export class PhotoFormatError extends Error {
  constructor() {
    super('不支援這個檔案格式');
    this.name = 'PhotoFormatError';
  }
}

async function decode(file: Blob): Promise<ImageBitmap> {
  try {
    return await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    // 舊瀏覽器不認得 options；再用預設值試一次，還是失敗才算格式不支援
    try {
      return await createImageBitmap(file);
    } catch {
      throw new PhotoFormatError();
    }
  }
}

const toJpeg = (canvas: HTMLCanvasElement, quality: number) =>
  new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(b => (b ? resolve(b) : reject(new Error('圖片轉檔失敗'))), 'image/jpeg', quality);
  });

export interface CompressOptions {
  maxEdge: number;
  /** 超過就逐步降低品質（伺服器上限） */
  maxBytes: number;
  qualities: readonly number[];
}

/** 長邊縮到 maxEdge 以內、JPEG、方向轉正、不帶 EXIF；超過 maxBytes 就逐步降低品質。評價與聊聊各給自己的參數 */
export async function compressPhoto(file: Blob, opts: CompressOptions): Promise<Blob> {
  const bitmap = await decode(file);
  try {
    const { width, height } = fitWithin(bitmap.width, bitmap.height, opts.maxEdge);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('瀏覽器無法建立畫布');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(bitmap, 0, 0, width, height);
    let blob = await toJpeg(canvas, opts.qualities[0]);
    for (const q of opts.qualities.slice(1)) {
      if (blob.size <= opts.maxBytes) break;
      blob = await toJpeg(canvas, q);
    }
    return blob;
  } finally {
    bitmap.close();
  }
}

/** 長邊 ≤ 1280、JPEG、方向轉正、不帶 EXIF；超過 2 MB 就逐步降低品質（伺服器上限） */
export const compressReviewPhoto = (file: Blob): Promise<Blob> =>
  compressPhoto(file, { maxEdge: MAX_EDGE, maxBytes: MAX_UPLOAD_BYTES, qualities: QUALITIES });
