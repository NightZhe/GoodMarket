import { NICKNAME_MAX, NICKNAME_MIN } from '../reviews/types';
import { isNicknameChar } from '../reviews/nickname';

// 從 Supabase 的 user 物件讀出「用什麼登入」「顯示什麼帳號名稱」「評價暱稱預填什麼」。
// 只依賴 user 的幾個標準欄位，用結構型別，不 import supabase，才測得到。

export interface UserLike {
  email?: string | null;
  app_metadata?: { provider?: string } | null;
  user_metadata?: Record<string, unknown> | null;
  identities?: { provider: string; last_sign_in_at?: string | null; identity_data?: Record<string, unknown> | null }[] | null;
}

export type LoginProvider = 'google' | 'apple' | 'email' | 'other';

const asProvider = (p: string | undefined): LoginProvider =>
  p === 'google' || p === 'apple' || p === 'email' ? p : 'other';

/**
 * 這個帳號用什麼登入。合併過身分的帳號（email 帳號後來又用 Google 登入）app_metadata.provider 永遠是最早的那個，
 * 所以優先看「最近登入的那個身分」，沒有 identities 才退回 app_metadata。
 */
export function loginProviderOf(user: UserLike): LoginProvider {
  const ids = (user.identities ?? []).filter(i => i.provider);
  if (ids.length > 0) {
    const latest = ids.reduce((a, b) => ((b.last_sign_in_at ?? '') > (a.last_sign_in_at ?? '') ? b : a));
    return asProvider(latest.provider);
  }
  return asProvider(user.app_metadata?.provider);
}

/** Apple 的「隱藏我的電子郵件」：每個服務拿到的是轉寄信箱，不是真實 email */
export const isPrivateRelay = (email: string | null | undefined) =>
  Boolean(email && /@privaterelay\.appleid\.com$/i.test(email.trim()));

export const PRIVATE_RELAY_LABEL = 'Apple 帳號（已隱藏電子郵件）';

/** 畫面上代表這個帳號的文字：email；隱藏信箱或沒有 email 時（Apple）顯示固定說法，不留空白 */
export function accountLabel(user: UserLike): string {
  const email = user.email?.trim();
  if (!email || isPrivateRelay(email)) return loginProviderOf(user) === 'apple' || isPrivateRelay(email) ? PRIVATE_RELAY_LABEL : '已登入的帳號';
  return email;
}

/** 「以 harry@gmail.com 登入」。Apple 隱藏信箱沒有 email 可顯示，用固定說法，不留空白 */
export function signedInText(user: UserLike, progressive = false): string {
  const label = accountLabel(user);
  if (label === PRIVATE_RELAY_LABEL) return progressive ? '以 Apple 帳號（已隱藏電子郵件）登入中' : '以 Apple 帳號登入（已隱藏電子郵件）';
  return `以 ${label} 登入${progressive ? '中' : ''}`;
}

export const providerLabel = (p: LoginProvider) =>
  p === 'google' ? 'Google' : p === 'apple' ? 'Apple' : 'Email';

// ───────── 評價暱稱預填（D10＝B、D19＝A） ─────────

export interface NameSource { provider: string; full_name?: unknown; name?: unknown }

const nonEmptyString = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v : null);

/**
 * Google 名稱 → 暱稱預填值。只有 Google 預填，Apple 網頁登入拿不到名稱、email 帳號沒有名稱，一律空白。
 * 去掉所有不合法的字元（含中間空白）→ 取前 12 個 code point → 不足 2 字留空。
 * 用 code point 而不是 UTF-16 單位：𠮷 這類擴充區漢字是 2 個單位、1 個字。
 * 結果一定通得過 validateNickname，使用者不改也能送出（共用測試向量見 nickname-prefill-vectors.ts）。
 */
export function prefillNickname(src: NameSource): string {
  if (src.provider !== 'google') return '';
  const raw = nonEmptyString(src.full_name) ?? nonEmptyString(src.name);
  if (!raw) return '';
  const kept = [...raw].filter(isNicknameChar).slice(0, NICKNAME_MAX);
  return kept.length < NICKNAME_MIN ? '' : kept.join('');
}

export interface NicknamePrefill {
  /** 預填進欄位的值（已通過暱稱規則） */
  value: string;
  /** Google 名稱原文；跟 value 不同代表被調整過，畫面要說明（S-8②） */
  original: string;
  adjusted: boolean;
}

/** 從 user 取 Google 名稱：優先看 Google 這個身分自己的資料（合併帳號時 user_metadata 可能是別的身分的） */
export function nicknamePrefillFor(user: UserLike | null): NicknamePrefill | null {
  if (!user) return null;
  const google = (user.identities ?? []).find(i => i.provider === 'google');
  const meta = google?.identity_data ?? (user.app_metadata?.provider === 'google' ? user.user_metadata : null);
  if (!meta) return null;
  const original = nonEmptyString(meta.full_name) ?? nonEmptyString(meta.name);
  if (!original) return null;
  const value = prefillNickname({ provider: 'google', full_name: meta.full_name, name: meta.name });
  if (!value) return null;
  return { value, original: original.trim(), adjusted: value !== original.trim() };
}
