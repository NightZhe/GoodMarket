import { useCallback, useEffect, useRef, useState } from 'react';
import { requestReviewUpload, reviewPhotoUrl, uploadReviewPhoto } from '../../lib/reviews/api';
import { draftKey, hasInput, parseDraft, splitUsablePhotos, type Draft } from '../../lib/reviews/draft';
import { ReviewError } from '../../lib/reviews/errors';
import { buildSubmitItems } from '../../lib/reviews/form';
import { compressReviewPhoto } from '../../lib/reviews/photos';
import type { SubmitItem } from '../../lib/reviews/types';
import { uploadPhoto, type PhotoItem, type UploadDeps, type UploadResult } from '../../lib/reviews/upload';

export interface ItemState { rating: number; content: string; photos: PhotoItem[] }
export interface EditorState { items: Record<string, ItemState>; nickname: string }

const emptyItem = (): ItemState => ({ rating: 0, content: '', photos: [] });

let photoSeq = 0;
const nextKey = () => `ph-${Date.now().toString(36)}-${++photoSeq}`;

/** 寫進 sessionStorage 的草稿：星等、文字、暱稱、已上傳成功的照片路徑 */
export function toDraft(s: EditorState): Draft {
  const items: Draft['items'] = {};
  for (const [id, it] of Object.entries(s.items)) {
    items[id] = {
      rating: it.rating, content: it.content,
      photos: it.photos.filter(p => p.status === 'done' && p.path && p.slot)
        .map(p => ({ path: p.path as string, expiresAt: p.slot!.expires_at })),
    };
  }
  return { nickname: s.nickname, items };
}

export const stateHasInput = (s: EditorState) => hasInput(toDraft(s)) || Object.values(s.items).some(i => i.photos.length > 0);

function readDraft(orderId: string): Draft | null {
  try { return parseDraft(sessionStorage.getItem(draftKey(orderId))); } catch { return null; }
}

export function clearDraft(orderId: string) {
  try { sessionStorage.removeItem(draftKey(orderId)); } catch { /* 隱私模式可能不能用 sessionStorage；沒有草稿可清就算了 */ }
}

function initialState(orderId: string, productIds: string[]): { state: EditorState; restored: boolean; dropped: number } {
  const items: Record<string, ItemState> = Object.fromEntries(productIds.map(id => [id, emptyItem()]));
  const draft = readDraft(orderId);
  if (!draft || !hasInput(draft)) return { state: { items, nickname: '' }, restored: false, dropped: 0 };
  let dropped = 0;
  for (const id of productIds) {
    const d = draft.items[id];
    if (!d) continue;
    const { kept, dropped: n } = splitUsablePhotos(d.photos, Date.now());
    dropped += n;
    items[id] = {
      rating: d.rating, content: d.content,
      photos: kept.map(p => ({
        key: nextKey(), status: 'done' as const, src: reviewPhotoUrl(p.path), path: p.path,
        slot: { path: p.path, expires_at: p.expiresAt },
      })),
    };
  }
  return { state: { items, nickname: draft.nickname }, restored: true, dropped };
}

interface Args {
  orderId: string;
  token: string;
  productIds: string[];
  /** 上傳／申請位置時遇到「訂單狀態變了」（已過期、已評價…）：交給頁面重新取得狀態 */
  onFatal: (e: ReviewError) => void;
}

/**
 * 評價表單的狀態與照片上傳。照片的壓縮與上傳在這裡排隊：
 * 壓縮一次一張（手機記憶體），上傳各自進行；每張照片自己有狀態，失敗可以單張重試。
 */
export function useReviewEditor({ orderId, token, productIds, onFatal }: Args) {
  const [init] = useState(() => initialState(orderId, productIds));
  const [state, setState] = useState<EditorState>(init.state);
  const stateRef = useRef(state);
  stateRef.current = state;
  const [notice] = useState({ restored: init.restored, dropped: init.dropped });

  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);

  // 草稿：延遲一下再寫，打字時不用每個字都寫。送出成功或確認離開後就不再寫（否則清掉之後又被寫回去）
  const draftOff = useRef(false);
  const discardDraft = useCallback(() => {
    draftOff.current = true;
    clearDraft(orderId);
  }, [orderId]);
  useEffect(() => {
    const t = setTimeout(() => {
      if (draftOff.current) return;
      try {
        if (stateHasInput(state)) sessionStorage.setItem(draftKey(orderId), JSON.stringify(toDraft(state)));
        else sessionStorage.removeItem(draftKey(orderId));
      } catch { /* 隱私模式不能寫 sessionStorage：沒有草稿功能，不影響填表 */ }
    }, 300);
    return () => clearTimeout(t);
  }, [state, orderId]);

  const patchItem = useCallback((productId: string, fn: (i: ItemState) => ItemState) => {
    setState(s => ({ ...s, items: { ...s.items, [productId]: fn(s.items[productId] ?? emptyItem()) } }));
  }, []);

  const patchPhoto = useCallback((productId: string, key: string, patch: Partial<PhotoItem>) => {
    patchItem(productId, i => ({ ...i, photos: i.photos.map(p => (p.key === key ? { ...p, ...patch } : p)) }));
  }, [patchItem]);

  const depsFor = useCallback((productId: string): UploadDeps => ({
    requestSlot: async () => (await requestReviewUpload(orderId, token, productId, 1))[0],
    upload: uploadReviewPhoto,
    now: Date.now,
  }), [orderId, token]);

  const applyResult = useCallback((productId: string, key: string, r: UploadResult) => {
    if (!alive.current) return;
    if (r.ok) {
      patchPhoto(productId, key, { status: 'done', path: r.path, slot: r.slot, failure: undefined });
      return;
    }
    patchPhoto(productId, key, {
      status: r.reason === 'limit' || r.reason === 'unusable' ? 'unusable' : 'failed',
      failure: r.reason, slot: r.slot,
    });
    if (r.reason === 'fatal' && r.error) onFatal(r.error);
  }, [patchPhoto, onFatal]);

  // 刪掉的照片：上傳或壓縮還在跑時，結果要丟掉。用「已刪除」清單而不是看 state，
  // 因為剛加入的照片在下一次 render 之前還不在 stateRef 裡
  const removed = useRef<Set<string>>(new Set());
  const stillThere = (_productId: string, key: string) => !removed.current.has(key);

  const startUpload = useCallback(async (productId: string, key: string, blob: Blob, slot: PhotoItem['slot']) => {
    patchPhoto(productId, key, { status: 'uploading', failure: undefined });
    const r = await uploadPhoto(blob, slot ?? null, depsFor(productId));
    if (stillThere(productId, key)) applyResult(productId, key, r); // 上傳中被刪掉的照片：結果直接丟掉
  }, [patchPhoto, depsFor, applyResult]);

  // 壓縮排隊：一次一張
  const queue = useRef<Promise<void>>(Promise.resolve());

  const addFiles = useCallback((productId: string, files: File[]) => {
    const fresh: { key: string; file: File }[] = files.map(file => ({ key: nextKey(), file }));
    patchItem(productId, i => ({
      ...i,
      photos: [...i.photos, ...fresh.map(f => ({ key: f.key, status: 'processing' as const, src: '' }))],
    }));
    for (const { key, file } of fresh) {
      queue.current = queue.current.then(async () => {
        if (!alive.current || !stillThere(productId, key)) return;
        let blob: Blob;
        try {
          blob = await compressReviewPhoto(file);
        } catch {
          // 解碼或轉檔失敗（HEIC 以外的怪格式、損毀的檔案）：這張標成「無法使用」，使用者只能刪除
          if (alive.current && stillThere(productId, key)) {
            patchPhoto(productId, key, { status: 'unusable', failure: 'unusable', src: '' });
          }
          return;
        }
        if (!alive.current || !stillThere(productId, key)) return;
        patchPhoto(productId, key, { src: URL.createObjectURL(blob), blob });
        void startUpload(productId, key, blob, null);
      });
    }
  }, [patchItem, patchPhoto, startUpload]);

  const retry = useCallback((productId: string, key: string) => {
    const p = stateRef.current.items[productId]?.photos.find(x => x.key === key);
    if (p?.blob) void startUpload(productId, key, p.blob, p.slot ?? null);
  }, [startUpload]);

  const removePhoto = useCallback((productId: string, key: string) => {
    const p = stateRef.current.items[productId]?.photos.find(x => x.key === key);
    if (p?.src.startsWith('blob:')) URL.revokeObjectURL(p.src);
    removed.current.add(key);
    patchItem(productId, i => ({ ...i, photos: i.photos.filter(x => x.key !== key) }));
  }, [patchItem]);

  // 離開頁面時釋放縮圖的物件網址
  useEffect(() => () => {
    for (const it of Object.values(stateRef.current.items)) {
      for (const p of it.photos) if (p.src.startsWith('blob:')) URL.revokeObjectURL(p.src);
    }
  }, []);

  /**
   * 送出時資料庫回 UPLOAD_EXPIRED（上傳位置已失效）：把有留在記憶體的照片用新的位置重傳一次（AC-72）。
   * 從草稿還原、沒有檔案可以重傳的照片，只能請使用者重新選取。回傳最新的路徑；null＝重傳失敗。
   */
  const reuploadAll = useCallback(async (ratedIds: string[]): Promise<Record<string, string[]> | null> => {
    const out: Record<string, string[]> = {};
    let ok = true;
    for (const productId of ratedIds) {
      const photos = stateRef.current.items[productId]?.photos ?? [];
      out[productId] = [];
      for (const p of photos) {
        if (p.status !== 'done') continue;
        if (!p.blob) {
          patchPhoto(productId, p.key, { status: 'unusable', failure: 'expired' });
          ok = false;
          continue;
        }
        patchPhoto(productId, p.key, { status: 'uploading', failure: undefined });
        const r = await uploadPhoto(p.blob, null, depsFor(productId));
        if (alive.current) applyResult(productId, p.key, r);
        if (r.ok) out[productId].push(r.path);
        else ok = false;
      }
    }
    return ok ? out : null;
  }, [patchPhoto, depsFor, applyResult]);

  return {
    state, setState, notice,
    setRating: (id: string, rating: number) => patchItem(id, i => ({ ...i, rating })),
    setContent: (id: string, content: string) => patchItem(id, i => ({ ...i, content })),
    setNickname: (nickname: string) => setState(s => ({ ...s, nickname })),
    addFiles, retry, removePhoto, reuploadAll, discardDraft,
  };
}

/** 依目前狀態組出 submit_reviews 的 p_items；overridePaths 是重傳後的新路徑 */
export function toSubmitItems(state: EditorState, overridePaths?: Record<string, string[]>): SubmitItem[] {
  return buildSubmitItems(Object.entries(state.items).map(([productId, i]) => ({
    productId, rating: i.rating, content: i.content,
    photos: overridePaths?.[productId]
      ? overridePaths[productId].map(path => ({ status: 'done' as const, path }))
      : i.photos,
  })));
}
