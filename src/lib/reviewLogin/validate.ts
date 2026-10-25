// 審查登入的前端輸入檢查（R-V4）：Email 格式不對或密碼空白就不送出。

export type EmailCheck = 'ok' | 'invalid';
export type PasswordCheck = 'ok' | 'empty';

// 只擋明顯不是 Email 的輸入（缺 @、缺網域、含空白）；真正的驗證交給伺服器
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateEmail(raw: string): EmailCheck {
  return EMAIL.test(raw.trim()) ? 'ok' : 'invalid';
}

/** 密碼不修剪：前後的空白也可能是密碼的一部分。全空白當作沒填 */
export function validatePassword(raw: string): PasswordCheck {
  return raw.trim() === '' ? 'empty' : 'ok';
}

export type ReviewLoginInput =
  | { ok: true; email: string; password: string }
  | { ok: false; email: EmailCheck; password: PasswordCheck; /** 焦點要移去的欄位 */ first: 'email' | 'password' };

export function validateReviewLogin(email: string, password: string): ReviewLoginInput {
  const e = validateEmail(email);
  const p = validatePassword(password);
  if (e === 'ok' && p === 'ok') return { ok: true, email: email.trim(), password };
  return { ok: false, email: e, password: p, first: e === 'ok' ? 'password' : 'email' };
}
