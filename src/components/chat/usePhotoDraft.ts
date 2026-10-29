import { useCallback, useEffect, useRef, useState } from 'react';
import { MAX_CHAT_PHOTOS, compressChatPhoto, compressedPhotoError, planChatIntake } from '../../lib/chat/images';
import type { OutgoingPhoto } from '../../lib/chat/useConversation';

export interface DraftPhoto {
  key: string;
  /** 處理中先用原檔預覽，壓縮完換成壓縮後的 JPEG */
  previewUrl: string;
  blob: Blob | null;
}

/**
 * 輸入列的待送出圖片：選取 → 檢查（張數、型別、原圖 20MB）→ 壓縮成 JPEG（長邊 ≤ 2048，去 EXIF）→ 壓縮後 ≤ 5MB 才留下。
 * 網頁版與 App 內原生相簿選出來的檔案走同一條路。送出時 take() 把圖交給送出流程（縮圖網址由那邊負責釋放）
 */
export function usePhotoDraft() {
  const [photos, setPhotos] = useState<DraftPhoto[]>([]);
  const [error, setError] = useState<string | null>(null);
  const photosRef = useRef<DraftPhoto[]>([]);
  const alive = useRef(true);

  const apply = useCallback((next: DraftPhoto[]) => {
    photosRef.current = next;
    setPhotos(next);
  }, []);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      photosRef.current.forEach(p => URL.revokeObjectURL(p.previewUrl));
    };
  }, []);

  const drop = useCallback((key: string) => {
    const gone = photosRef.current.find(p => p.key === key);
    if (gone) URL.revokeObjectURL(gone.previewUrl);
    apply(photosRef.current.filter(p => p.key !== key));
  }, [apply]);

  const add = useCallback((files: File[]) => {
    const plan = planChatIntake(files.map(f => ({ name: f.name, type: f.type, size: f.size })), photosRef.current.length);
    setError(plan.error);
    const fresh: { item: DraftPhoto; file: File }[] = plan.accepted.map(i => ({
      item: { key: crypto.randomUUID(), previewUrl: URL.createObjectURL(files[i]), blob: null },
      file: files[i],
    }));
    if (fresh.length === 0) return;
    apply([...photosRef.current, ...fresh.map(f => f.item)]);
    for (const { item, file } of fresh) {
      void compressChatPhoto(file).then(blob => {
        if (!alive.current) return;
        const tooBig = compressedPhotoError(blob.size);
        if (tooBig) { drop(item.key); setError(tooBig); return; }
        const url = URL.createObjectURL(blob);
        if (!photosRef.current.some(p => p.key === item.key)) { URL.revokeObjectURL(url); return; }
        URL.revokeObjectURL(item.previewUrl);
        apply(photosRef.current.map(p => (p.key === item.key ? { ...p, previewUrl: url, blob } : p)));
      }, () => {
        if (!alive.current) return;
        // 解不開的檔案（壞檔、不支援的格式）和「不是圖片」同一句，並把這張拿掉，不讓使用者卡住
        drop(item.key);
        setError('請選擇圖片檔');
      });
    }
  }, [apply, drop]);

  const remove = useCallback((key: string) => { drop(key); setError(null); }, [drop]);

  /** 交給送出流程：清空草稿但不釋放縮圖網址 */
  const take = useCallback((): OutgoingPhoto[] => {
    const ready = photosRef.current.filter((p): p is DraftPhoto & { blob: Blob } => p.blob !== null);
    apply([]);
    setError(null);
    return ready.map(p => ({ blob: p.blob, previewUrl: p.previewUrl }));
  }, [apply]);

  const processing = photos.some(p => p.blob === null);
  return { photos, error, setError, processing, add, remove, take, full: photos.length >= MAX_CHAT_PHOTOS };
}
