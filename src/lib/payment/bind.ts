import type { BindStatusResponse } from './types';

// 綁卡結果。結果以伺服器為準：3D 回來的網址參數（?bind=…&no=…）可被任何人改，只用來決定「去查哪一筆」。

/** 結果頁的種類（設計 7.4；後端的失敗只有 BIND_FAILED／BIND_NOT_FOUND 兩種代碼，3D 失敗與被中斷無法區分，併在 declined） */
export type BindKind = 'success' | 'duplicate' | 'declined' | 'unknown' | 'pending';

export function bindKindOfStatus(r: BindStatusResponse): BindKind {
  switch (r.status) {
    case 'bound': return r.duplicate ? 'duplicate' : 'success';
    case 'failed': return r.code === 'BIND_NOT_FOUND' ? 'unknown' : 'declined';
    case 'created':
    case 'confirming': return 'pending';
  }
}

/** 輪詢 payment-bind-status：每 2 秒一次、最多 60 秒（介面文件 2.3） */
export const BIND_POLL = { intervalMs: 2_000, maxMs: 60_000 } as const;

export interface BindReturn { hint: 'bound' | 'failed' | 'confirming'; no: string }

/** 3D 回跳的網址參數。編號只收英數、底線、連字號、64 字內，其餘一律當作沒有（不拿去查） */
export function parseBindReturn(q: URLSearchParams): BindReturn | null {
  const hint = q.get('bind');
  const no = q.get('no');
  if (hint !== 'bound' && hint !== 'failed' && hint !== 'confirming') return null;
  if (!no || no.length > 64 || !/^[A-Za-z0-9_-]+$/.test(no)) return null;
  return { hint, no };
}

/** 跳去 3D 之前記下「這次綁卡從哪裡來」，回來才知道主按鈕要寫「回到結帳」還是「回到付款方式」 */
export const BIND_SESSION_KEY = 'goodmarket_bind_session';
export interface BindSession { no: string; from: 'page' | 'checkout' }

/** 讀回來的資料一律當不可信；編號對不上這次回跳的就不採用 */
export function bindSessionOf(raw: string | null, no: string): BindSession | null {
  if (!raw) return null;
  try {
    const v: unknown = JSON.parse(raw);
    if (typeof v !== 'object' || v === null) return null;
    const o = v as Record<string, unknown>;
    if (o.no !== no) return null;
    return { no, from: o.from === 'checkout' ? 'checkout' : 'page' };
  } catch {
    return null;
  }
}

/** 綠界給的 yyyy/MM/dd HH:mm:ss 是台灣時間（UTC+8）；格式不對回 NaN，呼叫端當作已失效 */
export function taiwanTimeMs(s: string): number {
  const m = /^(\d{4})\/(\d{2})\/(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(s);
  return m ? Date.parse(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}+08:00`) : NaN;
}
