// 銀行帳號：bank-account-add 的純邏輯（輸入正規化／檢查、AES-256-GCM、fingerprint、amr 解析、錯誤碼對應）。
// 契約：.work/seller-bank-account/interface-bank-account-v2.md（v2.1）§3.2。
// 鐵則：完整帳號（原始或正規化後）不得出現在錯誤訊息、日誌或回應；這裡所有 throw 的訊息都是固定字串。
// 只用 Web Crypto／atob／btoa，Deno 與 Node（vitest）都能跑。

export class BankError extends Error {
  constructor(readonly code: string, message: string, readonly status = 400) { super(message); }
}

export const STEP_UP_WINDOW_SEC = 600;

// ── 輸入 ────────────────────────────────────────────────────────────────

export interface AddInput { bankCode: string; branchCode: string; account: string; holder: string; setPayout: boolean }

/** 去掉所有空白（含全形空白、NBSP）與連字號。 */
export const stripAccount = (s: string): string => s.replace(/[\s \u00a0\u3000-]/g, '');
/** 去頭尾空白（含全形空白、NBSP）。 */
export const trimText = (s: string): string => s.replace(/^[\s \u00a0\u3000]+|[\s \u00a0\u3000]+$/g, '');

/** 驗證並正規化請求本文。錯誤只回固定訊息，不夾帶任何輸入值。檢查順序＝契約 §3.2 的錯誤碼表。 */
export function parseAddBody(body: unknown): AddInput {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new BankError('REQUEST_INVALID', '請求格式不正確');
  const b = body as Record<string, unknown>;
  if (typeof b.bankCode !== 'string' || typeof b.account !== 'string' || typeof b.holder !== 'string'
      || !(b.branchCode === undefined || b.branchCode === null || typeof b.branchCode === 'string')
      || !(b.setPayout === undefined || typeof b.setPayout === 'boolean')) {
    throw new BankError('REQUEST_INVALID', '請求格式不正確');
  }
  if (!/^[0-9]{3}$/.test(b.bankCode)) throw new BankError('BANK_CODE_INVALID', '請選擇銀行');
  const branchCode = typeof b.branchCode === 'string' ? trimText(b.branchCode) : '';
  if (!/^[0-9]{4}$/.test(branchCode)) throw new BankError('BRANCH_CODE_INVALID', '請選擇分行');   // 必填（Q18）：缺／空／null 也是這個碼
  const account = stripAccount(b.account);
  if (!/^[0-9]{8,16}$/.test(account)) throw new BankError('ACCOUNT_NUMBER_INVALID', '帳號需為 8 到 16 位數字');
  const holder = trimText(b.holder);
  const len = [...holder].length;
  if (len < 1 || len > 50 || /[\u0000-\u001f\u007f-\u009f]/.test(holder)) {
    throw new BankError('ACCOUNT_HOLDER_INVALID', '戶名需為 1 到 50 個字，且不能含換行');
  }
  return { bankCode: b.bankCode, branchCode, account, holder, setPayout: b.setPayout === true };
}

// ── AES-256-GCM ─────────────────────────────────────────────────────────

const b64 = (u: Uint8Array): string => { let s = ''; for (const x of u) s += String.fromCharCode(x); return btoa(s); };
const unb64 = (s: string): Uint8Array => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

export interface KeyConfig { key: Uint8Array; version: number }

/** 讀 secret：BANK_ACCOUNT_KEY（base64 的 32 bytes）、BANK_ACCOUNT_KEY_VERSION（正整數，預設 1）。缺或格式錯 → BANK_KEY_MISSING。 */
export function parseKeyConfig(keyB64: string | undefined, versionRaw: string | undefined): KeyConfig {
  const fail = () => new BankError('BANK_KEY_MISSING', '系統尚未設定，請稍後再試', 500);
  if (!keyB64) throw fail();
  let key: Uint8Array;
  try { key = unb64(keyB64.trim()); } catch { throw fail(); }
  if (key.length !== 32) throw fail();
  const v = versionRaw === undefined || versionRaw === '' ? 1 : Number(versionRaw);
  if (!Number.isInteger(v) || v < 1 || v > 32767) throw fail();
  return { key, version: v };
}

/** 回傳 base64(iv(12) ‖ ciphertext ‖ tag(16))。IV 每次隨機。 */
export async function encryptAccount(key: Uint8Array, plaintext: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const k = await crypto.subtle.importKey('raw', key, 'AES-GCM', false, ['encrypt']);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, k, new TextEncoder().encode(plaintext)));
  const out = new Uint8Array(iv.length + ct.length);
  out.set(iv, 0); out.set(ct, iv.length);
  return b64(out);
}

/** 解密（本刀沒有任何執行路徑呼叫；給測試與日後撥款流程）。 */
export async function decryptAccount(key: Uint8Array, cipher: string): Promise<string> {
  const raw = unb64(cipher);
  const k = await crypto.subtle.importKey('raw', key, 'AES-GCM', false, ['decrypt']);
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: raw.slice(0, 12) }, k, raw.slice(12));
  return new TextDecoder().decode(pt);
}

// ── fingerprint（T2：全站唯一，不含 userId） ──────────────────────────────

const hmac = async (key: Uint8Array, msg: string): Promise<Uint8Array> => {
  const k = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(msg)));
};
const hex = (u: Uint8Array): string => [...u].map((x) => x.toString(16).padStart(2, '0')).join('');

/** hex(HMAC-SHA256(fpKey, bankCode|account))，fpKey＝HMAC-SHA256(BANK_ACCOUNT_KEY, 固定標籤)（不與 AES 共用原始金鑰）。
 *  同一個銀行帳號在全站得到同一個值，所以資料庫可用唯一限制擋「別人已綁」；沒有金鑰就窮舉不了 8～16 位數字。 */
export async function fingerprintAccount(key: Uint8Array, bankCode: string, account: string): Promise<string> {
  const fpKey = await hmac(key, 'goodmarket/bank-account/fingerprint/v1');
  return hex(await hmac(fpKey, `${bankCode}|${account}`));
}

// ── JWT amr ─────────────────────────────────────────────────────────────

/** 解 JWT payload（不驗簽；呼叫前必須已用 auth.getUser(token) 驗過同一個 token）。壞掉回 null。 */
export function jwtPayload(jwt: string): Record<string, unknown> | null {
  const part = jwt.split('.')[1];
  if (!part) return null;
  try {
    const s = part.replace(/-/g, '+').replace(/_/g, '/');
    const bin = atob(s + '='.repeat((4 - (s.length % 4)) % 4));
    const o = JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0))));
    return o && typeof o === 'object' ? o : null;
  } catch { return null; }
}

/** amr 中 method＝otp 的最新 timestamp（秒）換成 ISO 字串；沒有 → null。是否在 10 分鐘內由資料庫判斷（最後一道）。 */
export function latestOtpAt(jwt: string): string | null {
  const amr = jwtPayload(jwt)?.amr;
  if (!Array.isArray(amr)) return null;
  let best = -1;
  for (const e of amr) {
    if (e && typeof e === 'object' && (e as { method?: unknown }).method === 'otp') {
      const t = (e as { timestamp?: unknown }).timestamp;
      if (typeof t === 'number' && Number.isFinite(t) && t > best) best = t;
    }
  }
  return best < 0 ? null : new Date(best * 1000).toISOString();
}

// ── 資料庫錯誤 → HTTP ───────────────────────────────────────────────────

const STATUS: Record<string, number> = {
  NOT_AUTHENTICATED: 401, BANK_CODE_INVALID: 400, BRANCH_CODE_INVALID: 400, ACCOUNT_NUMBER_INVALID: 400, ACCOUNT_HOLDER_INVALID: 400,
  BANK_ACCOUNT_LIMIT: 409, BANK_ACCOUNT_DUPLICATE: 409, BANK_ACCOUNT_TAKEN: 409, PHONE_REQUIRED: 403, STEP_UP_REQUIRED: 403,
};
const MESSAGE: Record<string, string> = {
  NOT_AUTHENTICATED: '登入已過期，請重新登入', BANK_CODE_INVALID: '請選擇銀行', BRANCH_CODE_INVALID: '請選擇分行',
  ACCOUNT_NUMBER_INVALID: '帳號需為 8 到 16 位數字', ACCOUNT_HOLDER_INVALID: '戶名需為 1 到 50 個字，且不能含換行',
  BANK_ACCOUNT_LIMIT: '銀行帳號最多只能存 5 個，請先刪除不用的', BANK_ACCOUNT_DUPLICATE: '這個銀行帳號你已經綁過了',
  BANK_ACCOUNT_TAKEN: '這個銀行帳號已經被其他帳號綁定',
  PHONE_REQUIRED: '新增第二個銀行帳號前，要先綁定手機',
  STEP_UP_REQUIRED: '為了保護你的收款帳戶，新增銀行帳號前要先用簡訊驗證碼確認是你本人。',
};

/** 資料庫 RPC 錯誤的 hint＝錯誤碼（message 是中文，不採用）。已知碼照表回；其他一律 INTERNAL（不回傳資料庫的原始訊息）。 */
export function mapDbError(hint: unknown): BankError {
  const code = typeof hint === 'string' ? hint.trim() : '';
  if (Object.hasOwn(STATUS, code)) return new BankError(code, MESSAGE[code], STATUS[code]);
  return new BankError('INTERNAL', '系統忙碌，請稍後再試', 500);
}
