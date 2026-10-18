import type { StorageLike } from '../auth/pending';
import type { AddressDraft } from './address';

// 個人檔案與地址表單的草稿（R-A16）：登入過期時按「儲存」會開登入面板，登入是整頁跳到 Google／Apple 再回來，
// 頁面上的輸入會跟著消失。所以跳走之前把輸入暫存在 sessionStorage（跟著這個分頁，關掉就沒了），
// 登入回來後頁面只還原一次、不自動送出，由使用者再按一次儲存。
// 60 分鐘過期，只保留最新一筆；壞資料一律當作沒有並刪掉。

export const FORM_DRAFT_KEY = 'goodmarket_form_draft';
export const FORM_DRAFT_TTL_MS = 60 * 60 * 1000;

export type FormDraft =
  | { kind: 'profile'; nickname: string }
  | { kind: 'address'; id: string | null; isDefault: boolean; value: AddressDraft };

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown, max: number): string | null => (typeof v === 'string' ? v.slice(0, max) : null);

function parseValue(v: unknown): AddressDraft | null {
  if (!isObj(v)) return null;
  const recipient = str(v.recipient, 200);
  const phone = str(v.phone, 60);
  const city = str(v.city, 20);
  const district = str(v.district, 20);
  const detail = str(v.detail, 600);
  if (recipient === null || phone === null || city === null || district === null || detail === null) return null;
  return { recipient, phone, city, district, detail };
}

function parse(raw: string | null, now: number): FormDraft | null {
  if (!raw) return null;
  let d: unknown;
  try { d = JSON.parse(raw); } catch { return null; }
  if (!isObj(d) || typeof d.createdAt !== 'number' || !Number.isFinite(d.createdAt)) return null;
  if (now - d.createdAt >= FORM_DRAFT_TTL_MS) return null;
  if (d.kind === 'profile') {
    const nickname = str(d.nickname, 200);
    return nickname === null ? null : { kind: 'profile', nickname };
  }
  if (d.kind === 'address') {
    const value = parseValue(d.value);
    if (!value || typeof d.isDefault !== 'boolean' || (d.id !== null && typeof d.id !== 'string')) return null;
    return { kind: 'address', id: d.id, isDefault: d.isDefault, value };
  }
  return null;
}

/** 回傳 false＝這個瀏覽器擋住暫存，登入回來後輸入就沒了（呼叫端照樣開登入面板，不阻擋） */
export function saveFormDraft(store: StorageLike, draft: FormDraft, now: number): boolean {
  try {
    store.setItem(FORM_DRAFT_KEY, JSON.stringify({ ...draft, createdAt: now }));
    return true;
  } catch {
    return false;
  }
}

/** 取用＝讀出來並立刻刪掉。壞資料與過期的也會被刪掉 */
export function takeFormDraft(store: StorageLike, now: number): FormDraft | null {
  let raw: string | null = null;
  try {
    raw = store.getItem(FORM_DRAFT_KEY);
    store.removeItem(FORM_DRAFT_KEY);
  } catch {
    return null;
  }
  return parse(raw, now);
}
