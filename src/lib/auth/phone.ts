// 台灣手機號碼與簡訊驗證碼的整理（R-2、R-20）：買家面板、閘門、賣家中心、綁定手機共用，純函式。
// 只收台灣 +886 的 09 開頭行動門號；伺服器端的「只收台灣」靠 Twilio Geo Permissions，這裡只是第一道。

/** 驗證碼位數。正式站後台設 6（U-7）；前端只在這裡寫一次 */
export const CODE_LENGTH = 6;

/** 空白、連字號（含各種破折號）、括號：貼上時常見的分隔符 */
const SEPARATORS = /[\s\-‐-―−()（）]/g;

export type PhoneResult =
  | { ok: true; /** 送給 Supabase 的 E.164，例 +886912345678 */ e164: string; /** 畫面顯示用，例 0912345678 */ national: string }
  | { ok: false; reason: 'empty' | 'format' | 'foreign' };

export function normalizeTwPhone(raw: string): PhoneResult {
  const s = raw.normalize('NFKC').replace(SEPARATORS, '');
  if (s === '') return { ok: false, reason: 'empty' };

  let rest = s;
  if (s.startsWith('+')) {
    if (!s.startsWith('+886')) return { ok: false, reason: 'foreign' };
    rest = s.slice(4);
  } else if (s.startsWith('886')) {
    rest = s.slice(3);
  }
  // 09xxxxxxxx、9xxxxxxxx，以及常見的多打 0（+886 0912…）
  const m = /^0?(9\d{8})$/.exec(rest);
  if (!m) return { ok: false, reason: 'format' };
  return { ok: true, e164: `+886${m[1]}`, national: `0${m[1]}` };
}

/** 0912345678 → 0912-345-678 */
export const formatTwPhone = (national: string) => `${national.slice(0, 4)}-${national.slice(4, 7)}-${national.slice(7)}`;

/** 0912345678 → 0912-***-678（前 4、後 3） */
export const maskTwPhone = (national: string) => `${national.slice(0, 4)}-***-${national.slice(7)}`;

/** 讀屏念「星號」很怪，遮罩門號的 aria-label 改成這句 */
export const maskTwPhoneSpoken = (national: string) => `${national.slice(0, 4)}，中間三碼已隱藏，尾數 ${national.slice(7)}`;

/** auth.users.phone 存的是不含 + 的 886912345678；轉回 0912345678。不是台灣行動門號就是 null */
export function nationalFromAuthPhone(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const m = /^\+?886(9\d{8})$/.exec(phone.trim());
  return m ? `0${m[1]}` : null;
}

export type CodeResult = { ok: true; code: string } | { ok: false; reason: 'empty' | 'format' };

/** 驗證碼寬容輸入：全形轉半形、去空白與連字號；整理後必須剛好 CODE_LENGTH 位數字（不用 type=number，開頭的 0 要保留） */
export function normalizeCode(raw: string): CodeResult {
  const s = raw.normalize('NFKC').replace(SEPARATORS, '');
  if (s === '') return { ok: false, reason: 'empty' };
  return new RegExp(`^\\d{${CODE_LENGTH}}$`).test(s) ? { ok: true, code: s } : { ok: false, reason: 'format' };
}
