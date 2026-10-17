import { NICKNAME_MAX, NICKNAME_MIN } from './types';

// R-7：去頭尾空白 → 空字串視為沒填 → 2–12 個字（code point）→ 每個字只能是下列其中之一。
// 規則與資料庫逐字對齊（t3-interface.md「暱稱規則」，共用測試向量見 nickname-vectors.ts）：
//   漢字 U+3400–4DBF、4E00–9FFF、F900–FAFF、20000–2FA1F、30000–323AF；英文字母 A–Z a–z；阿拉伯數字；_ 與 -。
// 不可以改用 \p{L}、\p{Script=Han}、\w：它們的範圍跟資料庫不一樣（會放行假名、韓文、Ⅻ、全形英數等）。
// 這裡仍只是即時提示；最後以資料庫的檢查為準。

/** 頭尾空白：半形空白、tab、換行、U+00A0、全形空白 U+3000（不含其他 Unicode 空白） */
const EDGE_SPACE = /^[ \t\n\r\f\v\u00a0\u3000]+|[ \t\n\r\f\v\u00a0\u3000]+$/g;
const ALLOWED = /^[-_0-9A-Za-z\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\u{20000}-\u{2fa1f}\u{30000}-\u{323af}]+$/u;

export const NICKNAME_ERROR = `暱稱需為 ${NICKNAME_MIN}–${NICKNAME_MAX} 個字，只能用中英文、數字、_ 和 -`;

/** 單一個字元是不是暱稱允許的字（預填暱稱用同一套規則去掉不合法字元） */
export const isNicknameChar = (ch: string) => ALLOWED.test(ch);

export const normalizeNickname = (raw: string) => raw.replace(EDGE_SPACE, '');

export const codePointLength = (s: string) => [...s].length;

export type NicknameCheck =
  | { ok: true; value: string | null }
  | { ok: false; message: string };

export function validateNickname(raw: string): NicknameCheck {
  const v = normalizeNickname(raw);
  if (v === '') return { ok: true, value: null };
  const n = codePointLength(v);
  if (n < NICKNAME_MIN || n > NICKNAME_MAX || !ALLOWED.test(v)) return { ok: false, message: NICKNAME_ERROR };
  return { ok: true, value: v };
}

/** 公開時的遮罩預覽（與資料庫 _rv_mask 同規則）：3 字以上＝首字＋*****＋末字；2 字＝首字＋*****。 */
export function maskNickname(nickname: string): string {
  const chars = Array.from(nickname);
  if (chars.length < 2) return '匿名買家';
  if (chars.length === 2) return `${chars[0]}*****`;
  return `${chars[0]}*****${chars[chars.length - 1]}`;
}
