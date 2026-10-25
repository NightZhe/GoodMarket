import { REPORT_DETAILS_MAX } from './reasons';

// 檢舉說明的前端驗證。規則和資料庫 submit_report 相同或更寬鬆（不能比伺服器更嚴）：
// \r\n、\r → \n；去前後空白；去掉後是空字串＝沒填（送 null）；含 \n 以外的控制字元擋；超過 200 個 code point 擋。

/** U+0000–0009、000B–001F、007F–009F：換行（000A）允許 */
const BAD_CONTROL = /[\u0000-\u0009\u000B-\u001F\u007F-\u009F]/;

export const codePointLength = (s: string): number => [...s].length;

export const normalizeDetails = (raw: string): string => raw.replace(/\r\n?/g, '\n').trim();

export type DetailsCheck =
  | { ok: true; /** 要送出的值；沒填＝null */ value: string | null }
  | { ok: false; reason: 'too_long'; over: number }
  | { ok: false; reason: 'invalid_chars' };

export function checkDetails(raw: string): DetailsCheck {
  const value = normalizeDetails(raw);
  if (value === '') return { ok: true, value: null };
  if (BAD_CONTROL.test(value)) return { ok: false, reason: 'invalid_chars' };
  const len = codePointLength(value);
  if (len > REPORT_DETAILS_MAX) return { ok: false, reason: 'too_long', over: len - REPORT_DETAILS_MAX };
  return { ok: true, value };
}

/** 輸入框下方的「剩餘 N 字」。以去前後空白後的長度算，和送出時的判斷一致 */
export const remainingChars = (raw: string): number => REPORT_DETAILS_MAX - codePointLength(normalizeDetails(raw));
