// 圖片轉存：蝦皮 CDN 下載 → 長邊壓到 ≤ 800px → JPEG 0.8 → 上傳到好物集 Storage。
// 壓縮規格與 ProductForm 的 compress 相同（那份不動，這裡自己一份）；
// 差別只有一處：先鋪白底，否則透明背景的 PNG 轉 JPEG 會變黑。

export const MAX_EDGE = 800;
export const JPEG_QUALITY = 0.8;
export const MAX_ATTEMPTS = 3;
export const DOWNLOAD_TIMEOUT_MS = 30_000;
export const UPLOAD_TIMEOUT_MS = 60_000;

export type ImageFailureCode = 'IMAGE_DOWNLOAD_FAILED' | 'IMAGE_UPLOAD_FAILED';

export type TransferOutcome =
  | { ok: true; url: string }
  | { ok: false; code: ImageFailureCode };

export interface TransferDeps {
  /** 下載來源圖並壓縮（兩者任一失敗都算「下載失敗」：壞圖、不支援的格式與 404 對賣家是同一件事） */
  fetchAndCompress: (sourceUrl: string, signal: AbortSignal) => Promise<Blob>;
  /** 上傳到好物集 Storage，回傳公開網址 */
  upload: (blob: Blob) => Promise<string>;
  sleep: (ms: number, signal: AbortSignal) => Promise<void>;
  maxAttempts?: number;
}

export const abortError = () => new DOMException('已取消', 'AbortError');

export function sleepWithSignal(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(abortError()); return; }
    const t = setTimeout(() => { signal.removeEventListener('abort', onAbort); resolve(); }, ms);
    const onAbort = () => { clearTimeout(t); reject(abortError()); };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

/** 單張轉存：下載與上傳各自最多 3 次（F-3.4），重試間隔 0.4s、0.8s */
export async function transferImage(
  sourceUrl: string, deps: TransferDeps, signal: AbortSignal,
): Promise<TransferOutcome> {
  const attempts = deps.maxAttempts ?? MAX_ATTEMPTS;

  const withRetry = async <T>(fn: () => Promise<T>): Promise<{ ok: true; value: T } | { ok: false }> => {
    for (let i = 1; i <= attempts; i++) {
      if (signal.aborted) throw abortError();
      try {
        return { ok: true, value: await fn() };
      } catch {
        // 單次失敗不是終局：還有次數就重試，用完才回報失敗（呼叫端據此決定略過或整件失敗）
        if (signal.aborted) throw abortError();
        if (i === attempts) return { ok: false };
        await deps.sleep(400 * i, signal);
      }
    }
    return { ok: false };
  };

  const blob = await withRetry(() => deps.fetchAndCompress(sourceUrl, signal));
  if (!blob.ok) return { ok: false, code: 'IMAGE_DOWNLOAD_FAILED' };
  const url = await withRetry(() => deps.upload(blob.value));
  if (!url.ok) return { ok: false, code: 'IMAGE_UPLOAD_FAILED' };
  return { ok: true, url: url.value };
}

/**
 * 固定數量的工作者輪流取件。任何一件丟出例外就不再取新件，
 * 等進行中的做完後，把第一個例外丟出去（不留下還在背景跑的工作）。
 */
export async function runPool<T>(
  items: readonly T[], concurrency: number, worker: (item: T) => Promise<void>,
): Promise<void> {
  let next = 0;
  let failure: { error: unknown } | null = null;
  const loop = async () => {
    while (failure === null) {
      const i = next++;
      if (i >= items.length) return;
      try {
        await worker(items[i]);
      } catch (error) {
        failure ??= { error };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, loop));
  if (failure !== null) throw (failure as { error: unknown }).error;
}

// ───────── 瀏覽器實作 ─────────

function linkedSignal(signal: AbortSignal, timeoutMs: number): { signal: AbortSignal; dispose: () => void } {
  const ctl = new AbortController();
  const abort = () => ctl.abort();
  if (signal.aborted) abort();
  signal.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(abort, timeoutMs);
  return {
    signal: ctl.signal,
    dispose: () => { clearTimeout(timer); signal.removeEventListener('abort', abort); },
  };
}

/** 蝦皮 CDN 允許跨網域讀取（已實測）；不帶 cookie、不送 Referer */
export async function downloadImage(url: string, signal: AbortSignal): Promise<Blob> {
  const linked = linkedSignal(signal, DOWNLOAD_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      mode: 'cors', credentials: 'omit', referrerPolicy: 'no-referrer', signal: linked.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.blob();
  } finally {
    linked.dispose();
  }
}

/** 長邊 ≤ 800px（小於 800 不放大）、JPEG 0.8 */
export async function compressToJpeg(source: Blob): Promise<Blob> {
  const bitmap = await createImageBitmap(source);
  try {
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('瀏覽器無法建立畫布');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('圖片轉檔失敗'))), 'image/jpeg', JPEG_QUALITY);
    });
  } finally {
    bitmap.close();
  }
}

export const fetchAndCompress = async (url: string, signal: AbortSignal): Promise<Blob> =>
  compressToJpeg(await downloadImage(url, signal));

/** 在 promise 上加逾時；supabase-js 的 storage 上傳不接受 AbortSignal，逾時後只能放棄等待 */
export function withTimeout<T>(p: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(message)), ms);
    p.then(
      (v) => { clearTimeout(t); resolve(v); },
      (e: unknown) => { clearTimeout(t); reject(e instanceof Error ? e : new Error(String(e))); },
    );
  });
}
