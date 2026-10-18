import { NICKNAME_MAX, NICKNAME_MIN } from '../reviews/types';
import { isNicknameChar } from '../reviews/nickname';
import { maskTwPhone, nationalFromAuthPhone } from './phone';

// 從 Supabase 的 user 物件讀出「用什麼登入」「顯示什麼帳號名稱」「評價暱稱預填什麼」。
// 只依賴 user 的幾個標準欄位，用結構型別，不 import supabase，才測得到。

export interface UserLike {
  email?: string | null;
  /** 不含 +，例 886912345678（手機帳號的 email 是空字串，不是 null） */
  phone?: string | null;
  app_metadata?: { provider?: string } | null;
  user_metadata?: Record<string, unknown> | null;
  identities?: { provider: string; last_sign_in_at?: string | null; identity_data?: Record<string, unknown> | null }[] | null;
}

export type LoginProvider = 'google' | 'apple' | 'phone' | 'email' | 'other';

const asProvider = (p: string | undefined): LoginProvider =>
  p === 'google' || p === 'apple' || p === 'phone' || p === 'email' ? p : 'other';

/** session 的 amr（supabase.auth.mfa.getAuthenticatorAssuranceLevel() 的 currentAuthenticationMethods）：簡訊是 otp、Google／Apple 是 oauth、Email 密碼是 password */
export interface AuthMethod { method: string; timestamp?: number }

/** 綁定手機成功那一刻記下的「綁定前的登入方式」與時間（毫秒） */
export interface LoginVia { provider: LoginProvider; at: number }
const BIND_SESSION_WINDOW_MS = 30_000;

/** 最新的那一筆；沒有時間的話以陣列第一筆為準 */
const newestMethod = (methods: AuthMethod[]): AuthMethod =>
  methods.reduce((a, b) => ((b.timestamp ?? 0) > (a.timestamp ?? 0) ? b : a));

function latestIdentity(user: UserLike, only?: readonly string[]) {
  const ids = (user.identities ?? []).filter(i => i.provider && (!only || only.includes(i.provider)));
  return ids.length === 0 ? null : ids.reduce((a, b) => ((b.last_sign_in_at ?? '') > (a.last_sign_in_at ?? '') ? b : a));
}

/**
 * 這個帳號「這一次」用什麼登入。
 * 簡訊登入不會更新手機身分的 last_sign_in_at（t2 F-4），所以只看身分時間，Google 帳號綁了手機之後
 * 用手機登入也會被說成 Google。給了 session 的 amr 就以 amr 為準；amr 還沒讀到或不認得，才退回看身分：
 * 合併過身分的帳號 app_metadata.provider 永遠是最早的那個，所以優先看「最近登入的那個身分」。
 */
export function loginProviderOf(user: UserLike, methods?: AuthMethod[] | null, via?: LoginVia | null): LoginProvider {
  if (methods && methods.length > 0) {
    const newest = newestMethod(methods);
    // 綁定手機的驗證碼會換發一個新 session（amr 是 otp），使用者其實還是用原本的方式登入的：剛綁定完那一下維持綁定前的說法
    if (newest.method === 'otp' && via && newest.timestamp !== undefined && Math.abs(newest.timestamp * 1000 - via.at) <= BIND_SESSION_WINDOW_MS) return via.provider;
    switch (newest.method) {
      case 'oauth': {
        const oauth = latestIdentity(user, ['google', 'apple']);
        if (oauth) return asProvider(oauth.provider);
        break;
      }
      case 'otp':
        if (user.phone || (user.identities ?? []).some(i => i.provider === 'phone')) return 'phone';
        break;
      case 'password': return 'email';
    }
  }
  const latest = latestIdentity(user);
  return latest ? asProvider(latest.provider) : asProvider(user.app_metadata?.provider);
}

/** 登入用的手機號碼（0912345678）；沒有、或不是台灣行動門號就是 null */
export const phoneOf = (user: UserLike): string | null => nationalFromAuthPhone(user.phone);

/** Apple 的「隱藏我的電子郵件」：每個服務拿到的是轉寄信箱，不是真實 email */
export const isPrivateRelay = (email: string | null | undefined) =>
  Boolean(email && /@privaterelay\.appleid\.com$/i.test(email.trim()));

export const PRIVATE_RELAY_LABEL = 'Apple 帳號（已隱藏電子郵件）';

/**
 * 畫面上代表這個帳號的文字：這次用手機登入，或帳號沒有 email 只有門號 → 遮罩門號 0912-***-678；
 * 其他是 email；隱藏信箱或沒有 email 時（Apple）顯示固定說法，不留空白。
 * provider＝這次的登入方式（有 amr 時由呼叫端算好傳進來）；不給就用 loginProviderOf 的預設判斷。
 */
export function accountLabel(user: UserLike, provider: LoginProvider = loginProviderOf(user)): string {
  const email = user.email?.trim();
  const phone = phoneOf(user);
  if (phone && provider === 'phone') return maskTwPhone(phone);
  if (!email || isPrivateRelay(email)) {
    if (provider === 'apple' || isPrivateRelay(email)) return PRIVATE_RELAY_LABEL;
    return phone ? maskTwPhone(phone) : '已登入的帳號';
  }
  return email;
}

/** 「以 harry@gmail.com 登入」。Apple 隱藏信箱沒有 email 可顯示，用固定說法，不留空白 */
export function signedInText(user: UserLike, progressive = false, provider?: LoginProvider): string {
  const label = accountLabel(user, provider);
  if (label === PRIVATE_RELAY_LABEL) return progressive ? '以 Apple 帳號（已隱藏電子郵件）登入中' : '以 Apple 帳號登入（已隱藏電子郵件）';
  return `以 ${label} 登入${progressive ? '中' : ''}`;
}

export const providerLabel = (p: LoginProvider) =>
  p === 'google' ? 'Google' : p === 'apple' ? 'Apple' : p === 'phone' ? '手機' : 'Email';

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
