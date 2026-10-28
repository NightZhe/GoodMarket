// 銀行帳號（掛人、最多 5 筆、不可修改）的純邏輯。介面：.work/seller-bank-account/interface-bank-account-v2.md
// 格式檢查與伺服器同一條規則；伺服器為準，這裡只是第一道，讓使用者少跑一趟。
// 完整帳號只在表單的記憶體與送出的那一次請求裡出現：這個檔案不碰任何儲存、網址或 console。

export const BANK_LIMIT = 5;

export type BankStatus = 'pending' | 'verified' | 'rejected';
/** 撥款帳號的狀態（徽章與賣場總覽用）：沒有撥款帳號且沒有任何未通過的＝none */
export type PayoutState = 'none' | BankStatus;

/** get_my_bank_accounts 的單筆（契約 3.1）。沒有 user_id、密文、fingerprint、完整帳號 */
export interface BankAccount {
  id: string;
  bankCode: string;
  bankName: string;
  branchCode: string | null;
  branchName: string | null;
  branchCity: string | null;
  last4: string;
  holder: string;
  status: BankStatus;
  reason: string | null;
  isPayout: boolean;
  payoutSince: string | null;
  verifiedAt: string | null;
  createdAt: string;
}

export interface BankAccountList { limit: number; accounts: BankAccount[] }

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);

function parseOne(raw: unknown): BankAccount {
  if (!isObj(raw)) throw new Error('bank account: bad shape');
  const id = str(raw.id);
  const bankCode = str(raw.bank_code);
  const last4 = str(raw.last4);
  const holder = str(raw.holder);
  const createdAt = str(raw.created_at);
  const status = raw.status;
  if (!id || !bankCode || !last4 || !/^[0-9]{4}$/.test(last4) || holder === null || !createdAt || typeof raw.is_payout !== 'boolean') {
    throw new Error('bank account: missing fields');
  }
  if (status !== 'pending' && status !== 'verified' && status !== 'rejected') throw new Error('bank account: bad status');
  return {
    id, bankCode, bankName: str(raw.bank_name) ?? bankCode,
    branchCode: str(raw.branch_code), branchName: str(raw.branch_name), branchCity: str(raw.branch_city),
    last4, holder, status, reason: str(raw.reason),
    isPayout: raw.is_payout, payoutSince: str(raw.payout_since), verifiedAt: str(raw.verified_at), createdAt,
  };
}

/** 撥款帳號第一，其餘依建立時間由舊到新（伺服器已排好，這裡再保證一次） */
export const sortAccounts = (list: readonly BankAccount[]): BankAccount[] =>
  [...list].sort((a, b) => Number(b.isPayout) - Number(a.isPayout) || a.createdAt.localeCompare(b.createdAt));

/** 讀回來的資料一律當作不可信：缺欄位或狀態看不懂就當作讀不到（拋錯），不猜 */
export function parseBankAccountList(raw: unknown): BankAccountList {
  if (!isObj(raw) || !Array.isArray(raw.accounts)) throw new Error('bank accounts: bad shape');
  const limit = typeof raw.limit === 'number' && raw.limit > 0 ? raw.limit : BANK_LIMIT;
  return { limit, accounts: sortAccounts(raw.accounts.map(parseOne)) };
}

/** 契約 1：有撥款帳號→它的狀態；沒有撥款帳號但有任一筆未通過→rejected；其他→none */
export function payoutState(accounts: readonly BankAccount[]): PayoutState {
  const payout = accounts.find(a => a.isPayout);
  if (payout) return payout.status;
  return accounts.some(a => a.status === 'rejected') ? 'rejected' : 'none';
}

/** 有帳號但沒有撥款帳號（撥款帳號被標未通過後會這樣）：頁 A 頂端要提醒 */
export const lacksPayout = (accounts: readonly BankAccount[]): boolean =>
  accounts.length > 0 && !accounts.some(a => a.isPayout);

// ───────── 文字 ─────────

export const STATUS_LABEL: Record<BankStatus, string> = { pending: '待驗證', verified: '已驗證', rejected: '未通過' };
export const REJECTED_FALLBACK_REASON = '撥款時銀行退回，請確認帳號與戶名後重新新增。';

/** 賣家入口與賣場總覽用的徽章文字 */
export const PAYOUT_BADGE_TEXT: Record<PayoutState, string> = { none: '尚未設定', pending: '待驗證', verified: '已驗證', rejected: '未通過' };

export const last4Display = (last4: string): string => `••••${last4}`;
/** 讀屏：逐位唸，避免被讀成「一千二百三十四」 */
export const last4Spoken = (last4: string): string => `帳號末四碼 ${last4.split('').join('、')}`;
/** 動作鈕與對話框用：銀行名＋末四碼 */
export const accountTitle = (a: Pick<BankAccount, 'bankName' | 'last4'>): string => `${a.bankName} 末四碼 ${a.last4}`;
/** 分行的一行說明：「信義分行 · 末四碼 1234」 */
export const branchLine = (a: Pick<BankAccount, 'branchName' | 'last4'>): string =>
  [a.branchName, `末四碼 ${a.last4}`].filter(Boolean).join(' · ');

export const FULL_ACCOUNT_NOTE = '完整帳號會加密保存，畫面上只顯示末四碼。';
export const LIMIT_TEXT = '最多 5 個，請先刪除不用的。';
export const PAYOUT_NO_DELETE_MANY = '這是撥款帳號。要先把別的帳號設為撥款帳號，才能刪除這一個。';
export const PAYOUT_NO_DELETE_ONLY = '這是唯一的銀行帳號，也是撥款帳號，不能直接刪除。要換掉它，請先新增正確的帳號（新帳號會直接接手撥款），再刪除這一個。';
export const STEP_UP_NOTICE_EXPIRED = '驗證已過期，請重新驗證。你填的內容還在。';

// ───────── 格式檢查 ─────────

export const ACCOUNT_MIN = 8;
export const ACCOUNT_MAX = 16;
export const HOLDER_MAX = 50;

/** 帳號：全形轉半形、去掉空白（含全形、NBSP）與 -；保留開頭的 0，永遠當字串 */
export const normalizeAccount = (raw: string): string => raw.normalize('NFKC').replace(/[\s-]/g, '');
export const isDigits = (s: string): boolean => /^[0-9]*$/.test(s);
export const isValidAccount = (raw: string): boolean => /^[0-9]{8,16}$/.test(normalizeAccount(raw));

export const normalizeHolder = (raw: string): string => raw.trim();
const CONTROL = /[\p{Cc}\p{Zl}\p{Zp}]/u;
export const holderLength = (raw: string): number => [...normalizeHolder(raw)].length;
export const hasControlChar = (raw: string): boolean => CONTROL.test(normalizeHolder(raw));
export function isValidHolder(raw: string): boolean {
  const len = holderLength(raw);
  return len >= 1 && len <= HOLDER_MAX && !hasControlChar(raw);
}

/** 分行代碼：必填、4 位數字（契約 Q18）。是否屬於該銀行由伺服器檢查 */
export const isValidBranch = (raw: string): boolean => /^[0-9]{4}$/.test(raw.trim());

export interface BankOption { code: string; name: string }

export interface BankDraft {
  bankCode: string;
  city: string;
  branchCode: string;
  holder: string;
  account: string;
  account2: string;
  setPayout: boolean;
}
export const EMPTY_DRAFT: BankDraft = { bankCode: '', city: '', branchCode: '', holder: '', account: '', account2: '', setPayout: false };

export type BankField = 'bank' | 'city' | 'branch' | 'holder' | 'account' | 'account2';
export type FieldErrors = Partial<Record<BankField, string>>;

/** 欄位順序＝畫面順序，焦點移到第一個錯的 */
export const FIELD_ORDER: BankField[] = ['bank', 'city', 'branch', 'holder', 'account', 'account2'];

export const FIELD_ERROR_TEXT = {
  bank: '請選擇銀行',
  city: '請選擇地區',
  branch: '請選擇分行',
  holderEmpty: '請輸入戶名',
  holderLong: '戶名最多 50 個字',
  holderControl: '戶名不能有換行',
  accountEmpty: '請輸入帳號',
  accountDigits: '帳號只能是數字',
  accountLength: '帳號要 8 到 16 碼',
  account2Empty: '請再輸入一次帳號',
  account2Mismatch: '兩次輸入的帳號不一樣',
  accountDuplicate: '你已經綁過這個帳號了',
  accountTaken: '這個帳號已經被其他人綁定，請確認帳號是否正確',
} as const;

export function accountError(raw: string): string | undefined {
  const a = normalizeAccount(raw);
  if (a === '') return FIELD_ERROR_TEXT.accountEmpty;
  if (!isDigits(a)) return FIELD_ERROR_TEXT.accountDigits;
  if (a.length < ACCOUNT_MIN || a.length > ACCOUNT_MAX) return FIELD_ERROR_TEXT.accountLength;
  return undefined;
}

export function account2Error(account: string, again: string): string | undefined {
  const b = normalizeAccount(again);
  if (b === '') return FIELD_ERROR_TEXT.account2Empty;
  if (b !== normalizeAccount(account)) return FIELD_ERROR_TEXT.account2Mismatch;
  return undefined;
}

export function holderError(raw: string): string | undefined {
  if (normalizeHolder(raw) === '') return FIELD_ERROR_TEXT.holderEmpty;
  if (hasControlChar(raw)) return FIELD_ERROR_TEXT.holderControl;
  if (holderLength(raw) > HOLDER_MAX) return FIELD_ERROR_TEXT.holderLong;
  return undefined;
}

export function validateDraft(d: BankDraft, banks: readonly BankOption[]): FieldErrors {
  const e: FieldErrors = {};
  if (!banks.some(b => b.code === d.bankCode)) e.bank = FIELD_ERROR_TEXT.bank;
  if (d.city === '') e.city = FIELD_ERROR_TEXT.city;
  // 地區還沒選時分行是 disabled，不重複報錯；選了地區才驗分行
  if (d.city !== '' && !isValidBranch(d.branchCode)) e.branch = FIELD_ERROR_TEXT.branch;
  const h = holderError(d.holder);
  if (h) e.holder = h;
  const a = accountError(d.account);
  if (a) e.account = a;
  // 第二次帳號空白一律要報；兩次是否一致，等第一次帳號本身合法才比
  if (normalizeAccount(d.account2) === '') e.account2 = FIELD_ERROR_TEXT.account2Empty;
  else if (!a) {
    const a2 = account2Error(d.account, d.account2);
    if (a2) e.account2 = a2;
  }
  return e;
}

export const firstErrorField = (e: FieldErrors): BankField | null => FIELD_ORDER.find(f => e[f]) ?? null;

export interface AddBankRequest { bankCode: string; branchCode: string; account: string; holder: string; setPayout: boolean }

/** 送出的請求內容（契約 3.2）：帳號是去空白與 - 之後的字串。第一筆伺服器無視 setPayout */
export function toAddRequest(d: BankDraft): AddBankRequest {
  return {
    bankCode: d.bankCode, branchCode: d.branchCode.trim(), account: normalizeAccount(d.account),
    holder: normalizeHolder(d.holder), setPayout: d.setPayout,
  };
}

// ───────── 錯誤碼 → 文案（契約 8） ─────────

/** 伺服器退回的錯誤中，指向某個欄位的 */
export const ERROR_FIELD: Record<string, BankField> = {
  BANK_CODE_INVALID: 'bank',
  BRANCH_CODE_INVALID: 'branch',
  ACCOUNT_NUMBER_INVALID: 'account',
  ACCOUNT_HOLDER_INVALID: 'holder',
  BANK_ACCOUNT_DUPLICATE: 'account',
  BANK_ACCOUNT_TAKEN: 'account',
};

export const STEP_UP_TEXT = '為了保護你的收款帳戶，新增銀行帳號或更換撥款帳號前，要先用簡訊驗證碼確認是你本人。';
export const PHONE_REQUIRED_ADD_TEXT = '新增第二個銀行帳號前，要先用手機確認是你本人。';
export const PHONE_REQUIRED_PAYOUT_TEXT = '換撥款帳號前，要先用手機確認是你本人。';
const BUSY_TEXT = '系統忙碌，請稍後再試。';

const BANK_ERROR_TEXT: Record<string, string> = {
  BANK_CODE_INVALID: '這家銀行不在可選的清單內，請重新選擇。',
  BRANCH_CODE_INVALID: '找不到這個分行，請重新選擇地區與分行。',
  ACCOUNT_NUMBER_INVALID: FIELD_ERROR_TEXT.accountLength,
  ACCOUNT_HOLDER_INVALID: '戶名最多 50 個字，不能換行。',
  BANK_ACCOUNT_LIMIT: '最多 5 個銀行帳號，請先刪除不用的。',
  BANK_ACCOUNT_DUPLICATE: FIELD_ERROR_TEXT.accountDuplicate,
  BANK_ACCOUNT_TAKEN: FIELD_ERROR_TEXT.accountTaken,
  BANK_ACCOUNT_NOT_FOUND: '這個帳號已經不存在。',
  BANK_ACCOUNT_REJECTED: '未通過的帳號不能設為撥款帳號。',
  PAYOUT_ACCOUNT_CANNOT_DELETE: '這是撥款帳號，要先把別的帳號設為撥款帳號才能刪除。',
  PHONE_REQUIRED: PHONE_REQUIRED_ADD_TEXT,
  STEP_UP_REQUIRED: STEP_UP_TEXT,
  NOT_AUTHENTICATED: '登入已過期，請重新登入後再試。',
  REQUEST_INVALID: BUSY_TEXT,
  METHOD_NOT_ALLOWED: BUSY_TEXT,
  BANK_KEY_MISSING: '暫時無法儲存銀行帳號，請稍後再試。',
  INTERNAL: BUSY_TEXT,
};

/** 沒見過的碼與 null 用 fallback，畫面不得出現英文碼 */
export const bankErrorText = (code: string | null, fallback: string): string => (code && BANK_ERROR_TEXT[code]) || fallback;

export const UNAVAILABLE_TITLE = '銀行帳號暫時無法使用';
export const UNAVAILABLE_BODY = '請稍後再試，信用卡不受影響。';
export const ADD_UNAVAILABLE_TEXT = '暫時無法新增銀行帳號，請稍後再試。';

// ───────── 銀行搜尋 ─────────

/** 銀行名稱的搜尋比對：「台」「臺」視為同一字 */
const fold = (s: string): string => s.normalize('NFKC').toLowerCase().replaceAll('台', '臺').replace(/\s/g, '');

/** 依代碼（開頭相符）或名稱（包含）篩選；空白查詢回全部 */
export function filterBanks<T extends BankOption>(banks: readonly T[], query: string): T[] {
  const q = fold(query);
  if (q === '') return [...banks];
  return banks.filter(b => b.code.startsWith(q) || fold(b.name).includes(q));
}

export const bankLabel = (b: BankOption): string => `${b.code} ${b.name}`;
