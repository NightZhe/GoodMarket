import { useEffect, useId, useRef, useState } from 'react';
import { Camera, CircleAlert, ImageOff, LoaderCircle, RotateCw, TriangleAlert, X } from 'lucide-react';
import { MAX_PHOTOS } from '../../lib/reviews/types';
import { intakeNotice, planIntake } from '../../lib/reviews/photos';
import { UPLOAD_FAILURE_TEXT, type PhotoItem } from '../../lib/reviews/upload';
import { focusRing } from '../import/ui';

interface Props {
  productName: string;
  photos: PhotoItem[];
  onAdd: (files: File[]) => void;
  onRemove: (key: string) => void;
  onRetry: (key: string) => void;
}

const STATUS_WORD: Record<PhotoItem['status'], string> = {
  processing: '處理中', uploading: '上傳中', done: '已上傳', failed: '上傳失敗', unusable: '無法使用',
};

/** 表單的照片區：新增、縮圖、每張自己的上傳狀態、單張重試與刪除（design C-5） */
export default function PhotoPicker({ productName, photos, onAdd, onRemove, onRetry }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const addRef = useRef<HTMLButtonElement>(null);
  const deleteRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [removedNote, setRemovedNote] = useState('');
  const pendingFocus = useRef<number | null>(null);
  const noticeId = useId();
  const full = photos.length >= MAX_PHOTOS;

  const onPick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = ''; // 同一張照片刪掉後可以再選一次
    if (files.length === 0) return; // 取消選取：什麼都不顯示（R-20）
    const plan = planIntake(files, photos.length);
    setNotice(intakeNotice(plan));
    if (plan.accepted.length > 0) onAdd(plan.accepted.map(i => files[i]));
  };

  const remove = (index: number) => {
    setRemovedNote(`已刪除第 ${index + 1} 張照片`);
    pendingFocus.current = index;
    onRemove(photos[index].key);
  };

  // 刪除後焦點移到下一格的刪除鈕；沒有下一格就移到「新增照片」
  useEffect(() => {
    if (pendingFocus.current === null) return;
    const i = pendingFocus.current;
    pendingFocus.current = null;
    (deleteRefs.current[i] ?? addRef.current)?.focus();
  }, [photos.length]);

  // 每張照片的狀態變化寫進 live region，讓讀屏唸出上傳進度
  const prev = useRef<Map<string, PhotoItem['status']>>(new Map());
  const [announce, setAnnounce] = useState('');
  useEffect(() => {
    const msgs: string[] = [];
    photos.forEach((p, i) => {
      const before = prev.current.get(p.key);
      if (before && before !== p.status && (p.status === 'done' || p.status === 'failed' || p.status === 'unusable')) {
        msgs.push(`第 ${i + 1} 張照片${p.status === 'done' ? '已上傳' : '上傳失敗'}`);
      }
    });
    prev.current = new Map(photos.map(p => [p.key, p.status]));
    if (msgs.length > 0) setAnnounce(msgs.join('，'));
  }, [photos]);

  const busy = photos.filter(p => p.status === 'processing' || p.status === 'uploading').length;
  const errors = Array.from(new Set(photos.flatMap((p, i) =>
    p.status === 'failed' || p.status === 'unusable' ? [UPLOAD_FAILURE_TEXT[p.failure ?? 'network'](i + 1)] : [])));

  deleteRefs.current.length = photos.length;

  return (
    <div>
      <p className="text-sm font-medium">照片<span className="font-normal text-muted">（選填）</span></p>
      <ul className="mt-2 grid grid-cols-3 gap-2 md:grid-cols-6 md:gap-3">
        {photos.map((p, i) => {
          const bad = p.status === 'failed' || p.status === 'unusable';
          const cover = p.status === 'uploading' || bad;
          return (
            <li
              key={p.key}
              className={`relative aspect-square overflow-hidden rounded-sm ${bad ? 'border-2 border-error-border' : 'border border-line'}`}
            >
              {p.status === 'processing' ? (
                <div className="flex h-full w-full flex-col items-center justify-center gap-1 bg-canvas text-xs">
                  <LoaderCircle size={22} className="text-muted motion-safe:animate-spin" aria-hidden="true" />
                  處理中
                </div>
              ) : (
                <img src={p.src} alt="" className="h-full w-full object-cover" />
              )}
              <span className="sr-only">第 {i + 1} 張照片，{STATUS_WORD[p.status]}</span>

              {cover && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-ink/75 text-xs text-white">
                  {p.status === 'uploading' && <><LoaderCircle size={22} className="motion-safe:animate-spin" aria-hidden="true" />上傳中</>}
                  {p.status === 'failed' && <><RotateCw size={22} aria-hidden="true" />重試</>}
                  {p.status === 'unusable' && <><ImageOff size={22} aria-hidden="true" />無法使用</>}
                </div>
              )}
              {p.status === 'failed' && (
                <button
                  type="button" onClick={() => onRetry(p.key)} aria-label={`重試上傳第 ${i + 1} 張照片`}
                  className={`absolute inset-0 z-0 ${focusRing}`}
                />
              )}
              <button
                ref={el => { deleteRefs.current[i] = el; }}
                type="button" onClick={() => remove(i)} aria-label={`刪除第 ${i + 1} 張照片`}
                className={`absolute right-0 top-0 z-10 flex h-11 w-11 items-start justify-end p-1 ${focusRing}`}
              >
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-ink/75 text-white ring-1 ring-white/70">
                  <X size={16} aria-hidden="true" />
                </span>
              </button>
            </li>
          );
        })}
        <li>
          <button
            ref={addRef} type="button" aria-disabled={full || undefined} aria-describedby={noticeId}
            onClick={() => { if (!full) inputRef.current?.click(); }}
            className={`flex aspect-square w-full flex-col items-center justify-center gap-1 rounded-sm border-2 border-dashed border-disabled p-1 text-center text-xs ${full ? 'bg-canvas text-muted' : 'bg-white text-ink hover:bg-canvas'} ${focusRing}`}
          >
            <Camera size={24} className="text-muted" aria-hidden="true" />
            新增照片
            <span className="text-muted">({photos.length}/{MAX_PHOTOS})</span>
            <span className="sr-only">{productName}</span>
          </button>
        </li>
      </ul>
      {/* 不加 capture：加了 iPhone 會直接開相機，不能選圖庫 */}
      <input
        ref={inputRef} type="file" accept="image/*" multiple tabIndex={-1} aria-hidden="true"
        className="sr-only" onChange={onPick}
      />

      <div id={noticeId} role="status" aria-live="polite" className="mt-2 space-y-1 text-sm">
        {notice && (
          <p className="flex items-start gap-1.5"><TriangleAlert size={16} className="mt-0.5 shrink-0 text-warning-text" aria-hidden="true" />{notice}</p>
        )}
        {busy > 0 && (
          <p className="flex items-center gap-1.5"><LoaderCircle size={16} className="shrink-0 motion-safe:animate-spin" aria-hidden="true" />{busy} 張照片上傳中…</p>
        )}
        <span className="sr-only">{announce}{removedNote && `。${removedNote}`}</span>
      </div>
      {errors.length > 0 && (
        <ul role="alert" className="mt-1 space-y-1 text-sm text-error-text">
          {errors.map(m => (
            <li key={m} className="flex items-start gap-1.5"><CircleAlert size={16} className="mt-0.5 shrink-0" aria-hidden="true" />{m}</li>
          ))}
        </ul>
      )}
      <p className="mt-2 text-xs text-muted">最多 {MAX_PHOTOS} 張。上傳前會自動壓縮，並移除拍攝位置等資訊。</p>
    </div>
  );
}
