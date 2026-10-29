import { isNative } from './platform';

// 原生照片選擇器（R-M8a、D7）：App 內「直接開相簿」，沒有拍照選項。外掛只在 App 內動態載入，網頁 bundle 不帶（同 haptics.ts、share.ts）。
// 網頁版不走這裡，用系統檔案選擇器 <input type=file accept="image/*">。
// 用 chooseFromGallery（@capacitor/camera 8.1 起的新 API）；pickImages 已被外掛標為棄用。
// iOS 外掛在開相簿前會先確認照片權限，Info.plist 需要 NSPhotoLibraryUsageDescription（已加）。

export type PickOutcome =
  | { kind: 'picked'; files: File[] }
  | { kind: 'cancelled' }
  /** 沒權限或相簿打不開：呼叫端顯示「無法開啟相簿，請到『設定 › 好物集 › 照片』允許存取」 */
  | { kind: 'failed'; reason: 'denied' | 'failed' };

export type PickErrorKind = 'cancelled' | 'denied' | 'failed';

/** 外掛的錯誤沒有穩定的錯誤碼可比對，退而看訊息文字。認不得的一律當「打不開」，使用者看得到提示，不會默默沒反應 */
export function classifyPickError(e: unknown): PickErrorKind {
  const text = (e instanceof Error ? e.message : typeof e === 'object' && e !== null ? `${(e as { code?: unknown }).code ?? ''} ${(e as { message?: unknown }).message ?? ''}` : '').toLowerCase();
  if (/cancel|no image picked|no media/.test(text)) return 'cancelled';
  if (/denied|permission|not granted|authori[sz]/.test(text)) return 'denied';
  return 'failed';
}

/** 開系統相簿，最多選 limit 張。回 File（JPEG），後續走和網頁版同一條壓縮與檢查流程 */
export async function pickPhotosNative(limit: number): Promise<PickOutcome> {
  if (!isNative()) return { kind: 'failed', reason: 'failed' };
  try {
    const { Camera, MediaTypeSelection } = await import('@capacitor/camera');
    const { results } = await Camera.chooseFromGallery({
      mediaType: MediaTypeSelection.Photo, allowMultipleSelection: true, limit: Math.max(1, limit), quality: 90,
    });
    const files = await Promise.all(results.map(async (r, i) => {
      const blob = await (await fetch(r.webPath ?? '')).blob();
      return new File([blob], `photo-${i + 1}.jpg`, { type: blob.type || 'image/jpeg' });
    }));
    return files.length === 0 ? { kind: 'cancelled' } : { kind: 'picked', files };
  } catch (e) {
    const kind = classifyPickError(e);
    return kind === 'cancelled' ? { kind: 'cancelled' } : { kind: 'failed', reason: kind };
  }
}
