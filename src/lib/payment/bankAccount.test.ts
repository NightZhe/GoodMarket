import { describe, expect, it } from 'vitest';
import {
  EMPTY_DRAFT, accountTitle, bankErrorText, branchLine, filterBanks, firstErrorField, isValidAccount, isValidBranch, isValidHolder, last4Display, last4Spoken,
  lacksPayout, normalizeAccount, parseBankAccountList, payoutState, toAddRequest, validateDraft, type BankAccount, type BankDraft,
} from './bankAccount';

const raw = (over: Record<string, unknown> = {}) => ({
  id: 'a1', bank_code: '822', bank_name: '中國信託商業銀行', branch_code: '0037', branch_name: '信義分行', branch_city: '臺北市',
  last4: '1234', holder: '王小明', status: 'pending', reason: null, is_payout: false, payout_since: null, verified_at: null, created_at: '2026-10-29T01:00:00Z', ...over,
});

const acct = (over: Partial<BankAccount> = {}): BankAccount => ({
  id: 'a1', bankCode: '822', bankName: '中國信託商業銀行', branchCode: '0037', branchName: '信義分行', branchCity: '臺北市',
  last4: '1234', holder: '王小明', status: 'pending', reason: null, isPayout: false, payoutSince: null, verifiedAt: null, createdAt: '2026-10-29T01:00:00Z', ...over,
});

describe('parseBankAccountList：讀回來的資料不信任', () => {
  it('空列表是 []，limit 預設 5', () => {
    expect(parseBankAccountList({ limit: 5, accounts: [] })).toEqual({ limit: 5, accounts: [] });
    expect(parseBankAccountList({ accounts: [] }).limit).toBe(5);
  });
  it('撥款帳號排第一，其餘依建立時間由舊到新', () => {
    const list = parseBankAccountList({ limit: 5, accounts: [
      raw({ id: 'b', created_at: '2026-10-29T03:00:00Z' }),
      raw({ id: 'p', created_at: '2026-10-29T02:00:00Z', is_payout: true, payout_since: '2026-10-29T02:00:00Z' }),
      raw({ id: 'a', created_at: '2026-10-29T01:00:00Z' }),
    ] });
    expect(list.accounts.map(a => a.id)).toEqual(['p', 'a', 'b']);
  });
  it('欄位轉成 camelCase，分行可為 null', () => {
    const [a] = parseBankAccountList({ accounts: [raw({ branch_code: null, branch_name: null, branch_city: null })] }).accounts;
    expect(a).toMatchObject({ bankCode: '822', last4: '1234', isPayout: false, branchCode: null });
  });
  it('缺欄位、末四碼格式錯、狀態看不懂、不是物件：拋錯', () => {
    for (const bad of [null, 'x', {}, { accounts: 'x' }]) expect(() => parseBankAccountList(bad)).toThrow();
    expect(() => parseBankAccountList({ accounts: [raw({ last4: '12' })] })).toThrow();
    expect(() => parseBankAccountList({ accounts: [raw({ status: 'approved' })] })).toThrow();
    expect(() => parseBankAccountList({ accounts: [raw({ id: undefined })] })).toThrow();
    expect(() => parseBankAccountList({ accounts: [raw({ is_payout: 'yes' })] })).toThrow();
  });
});

describe('payoutState：徽章的四態（契約 1）', () => {
  it('沒有任何帳號→none', () => expect(payoutState([])).toBe('none'));
  it('有撥款帳號→它的狀態', () => {
    expect(payoutState([acct({ isPayout: true, status: 'pending' })])).toBe('pending');
    expect(payoutState([acct({ isPayout: true, status: 'verified' }), acct({ id: 'b', status: 'rejected' })])).toBe('verified');
  });
  it('沒有撥款帳號但有未通過→rejected；只有一般帳號→none', () => {
    expect(payoutState([acct({ status: 'rejected', reason: 'x' })])).toBe('rejected');
    expect(payoutState([acct({ status: 'pending' })])).toBe('none');
  });
  it('lacksPayout：有帳號但沒有撥款帳號', () => {
    expect(lacksPayout([])).toBe(false);
    expect(lacksPayout([acct()])).toBe(true);
    expect(lacksPayout([acct({ isPayout: true })])).toBe(false);
  });
});

describe('帳號格式', () => {
  it('去掉空白（含全形、NBSP）與 -，全形數字轉半形，保留開頭的 0', () => {
    expect(normalizeAccount('0012-3456 7890')).toBe('001234567890');
    expect(normalizeAccount('００１２ 3456　7890')).toBe('001234567890');
  });
  it('8～16 位數字才合法', () => {
    expect(isValidAccount('1234567')).toBe(false);
    expect(isValidAccount('12345678')).toBe(true);
    expect(isValidAccount('1234567890123456')).toBe(true);
    expect(isValidAccount('12345678901234567')).toBe(false);
    expect(isValidAccount('1234abcd5678')).toBe(false);
  });
});

describe('戶名與分行', () => {
  it('戶名 1～50 字、不含換行', () => {
    expect(isValidHolder('王小明')).toBe(true);
    expect(isValidHolder('   ')).toBe(false);
    expect(isValidHolder('王'.repeat(50))).toBe(true);
    expect(isValidHolder('王'.repeat(51))).toBe(false);
    expect(isValidHolder('王\n小明')).toBe(false);
  });
  it('分行必填且是 4 位數字（空＝錯）', () => {
    expect(isValidBranch('')).toBe(false);
    expect(isValidBranch('037')).toBe(false);
    expect(isValidBranch('0037')).toBe(true);
  });
});

describe('validateDraft：欄位順序與文案', () => {
  const banks = [{ code: '822', name: '中國信託商業銀行' }];
  const ok: BankDraft = { ...EMPTY_DRAFT, bankCode: '822', city: '臺北市', branchCode: '0037', holder: '王小明', account: '12345678', account2: '1234-5678' };
  it('全部正確：沒有錯', () => expect(validateDraft(ok, banks)).toEqual({}));
  it('全空：逐欄指出，第一個錯的是銀行', () => {
    const e = validateDraft(EMPTY_DRAFT, banks);
    expect(e).toMatchObject({ bank: '請選擇銀行', city: '請選擇地區', branch: '請選擇分行', holder: '請輸入戶名', account: '請輸入帳號' });
    expect(firstErrorField(e)).toBe('bank');
  });
  it('帳號：非數字、長度、兩次不一致', () => {
    expect(validateDraft({ ...ok, account: '1234abcd' }, banks).account).toBe('帳號只能是數字');
    expect(validateDraft({ ...ok, account: '123', account2: '123' }, banks).account).toBe('帳號要 8 到 16 碼');
    expect(validateDraft({ ...ok, account2: '87654321' }, banks).account2).toBe('兩次輸入的帳號不一樣');
    expect(validateDraft({ ...ok, account2: '' }, banks).account2).toBe('請再輸入一次帳號');
  });
  it('帳號有錯時不再報第二次帳號的錯', () => {
    expect(validateDraft({ ...ok, account: '1', account2: '' }, banks).account2).toBeUndefined();
  });
  it('戶名：過長與換行', () => {
    expect(validateDraft({ ...ok, holder: '王'.repeat(51) }, banks).holder).toBe('戶名最多 50 個字');
    expect(validateDraft({ ...ok, holder: '王\n明' }, banks).holder).toBe('戶名不能有換行');
  });
});

describe('toAddRequest', () => {
  it('帳號去空白與 -，戶名去頭尾空白，帶 setPayout', () => {
    expect(toAddRequest({ ...EMPTY_DRAFT, bankCode: '004', branchCode: '0037', account: '0012-3456 7890', holder: ' 王小明 ', setPayout: true }))
      .toEqual({ bankCode: '004', branchCode: '0037', account: '001234567890', holder: '王小明', setPayout: true });
  });
});

describe('錯誤碼文案：每個碼都有中文，沒見過的用 fallback', () => {
  const codes = ['STEP_UP_REQUIRED', 'PHONE_REQUIRED', 'BANK_ACCOUNT_LIMIT', 'BANK_ACCOUNT_DUPLICATE', 'BANK_ACCOUNT_TAKEN', 'BANK_ACCOUNT_NOT_FOUND', 'BANK_ACCOUNT_REJECTED',
    'PAYOUT_ACCOUNT_CANNOT_DELETE', 'BANK_CODE_INVALID', 'BRANCH_CODE_INVALID', 'ACCOUNT_NUMBER_INVALID', 'ACCOUNT_HOLDER_INVALID', 'NOT_AUTHENTICATED',
    'BANK_KEY_MISSING', 'INTERNAL', 'REQUEST_INVALID', 'METHOD_NOT_ALLOWED'];
  it('契約 8 的每個碼都查得到，且不含英文碼', () => {
    for (const c of codes) {
      const t = bankErrorText(c, 'FALLBACK');
      expect(t, c).not.toBe('FALLBACK');
      expect(t, c).not.toMatch(/[A-Z]{3,}_/);
    }
  });
  it('未知碼與 null 走 fallback', () => {
    expect(bankErrorText('WHAT', 'fb')).toBe('fb');
    expect(bankErrorText(null, 'fb')).toBe('fb');
  });
});

describe('顯示', () => {
  it('末四碼：畫面用 ••••，讀屏逐位唸', () => {
    expect(last4Display('1234')).toBe('••••1234');
    expect(last4Spoken('1234')).toBe('帳號末四碼 1、2、3、4');
  });
  it('標題與分行行', () => {
    expect(accountTitle(acct())).toBe('中國信託商業銀行 末四碼 1234');
    expect(branchLine(acct())).toBe('信義分行 · 末四碼 1234');
    expect(branchLine(acct({ branchName: null }))).toBe('末四碼 1234');
  });
});

describe('filterBanks：台臺同字、代碼開頭相符', () => {
  const banks = [{ code: '004', name: '臺灣銀行' }, { code: '822', name: '中國信託商業銀行' }, { code: '812', name: '台新國際商業銀行' }];
  it('台灣銀行找得到臺灣銀行', () => expect(filterBanks(banks, '台灣').map(b => b.code)).toEqual(['004']));
  it('臺新找得到台新', () => expect(filterBanks(banks, '臺新').map(b => b.code)).toEqual(['812']));
  it('代碼只比開頭', () => {
    expect(filterBanks(banks, '82').map(b => b.code)).toEqual(['822']);
    expect(filterBanks(banks, '22')).toEqual([]);
  });
  it('空白查詢回全部', () => expect(filterBanks(banks, '  ')).toHaveLength(3));
});
