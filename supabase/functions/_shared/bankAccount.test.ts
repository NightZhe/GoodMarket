import { describe, expect, it } from 'vitest';
import {
  BankError, decryptAccount, encryptAccount, fingerprintAccount, jwtPayload, latestOtpAt, mapDbError, parseAddBody, parseKeyConfig, stripAccount,
} from './bankAccount.ts';

const KEY = new Uint8Array(32).map((_, i) => i + 1);
const KEY_B64 = btoa(String.fromCharCode(...KEY));
const good = { bankCode: '004', branchCode: '0037', account: '0012-3456 7890', holder: '王小明' };
const codeOf = (fn: () => unknown): string => { try { fn(); } catch (e) { return e instanceof BankError ? e.code : 'OTHER:' + String(e); } return 'NO_ERROR'; };

describe('parseAddBody：帳號正規化（AC-10、AC-11）', () => {
  it('去空白（含全形）與 -，保留開頭的 0', () => {
    expect(parseAddBody(good).account).toBe('001234567890');
    expect(stripAccount('00　12-34 56 78')).toBe('00123456' + '78');
  });
  it('全形數字轉半形（含混用全形空白、ASCII 連字號）', () => {
    expect(parseAddBody({ ...good, account: '００１２-３４５６　７８９０' }).account).toBe('001234567890');
    expect(stripAccount('１２３４５６７８')).toBe('12345678');
  });
  it('8 與 16 碼可、7 與 17 碼不可、含字母不可、全形數字不可', () => {
    expect(parseAddBody({ ...good, account: '12345678' }).account).toBe('12345678');
    expect(parseAddBody({ ...good, account: '1234567890123456' }).account).toHaveLength(16);
    for (const a of ['1234567', '12345678901234567', '1234567a', '１２３４５６７Ａ', '', '--- ---']) {
      expect(codeOf(() => parseAddBody({ ...good, account: a }))).toBe('ACCOUNT_NUMBER_INVALID');
    }
  });
  it('帳號不是字串（數字會丟掉開頭的 0）→ REQUEST_INVALID', () => {
    expect(codeOf(() => parseAddBody({ ...good, account: 12345678 }))).toBe('REQUEST_INVALID');
  });
});

describe('parseAddBody：其他欄位（AC-12～AC-14）', () => {
  it('body 不是物件／缺欄位／型別錯 → REQUEST_INVALID', () => {
    for (const b of [null, undefined, 'x', 5, [], {}, { ...good, bankCode: 4 }, { ...good, holder: null }, { ...good, branchCode: 37 }, { ...good, setPayout: 'x' }]) {
      expect(codeOf(() => parseAddBody(b))).toBe('REQUEST_INVALID');
    }
  });
  it('銀行代碼不是 3 位數字 → BANK_CODE_INVALID', () => {
    for (const c of ['', '04', '0040', 'abc']) expect(codeOf(() => parseAddBody({ ...good, bankCode: c }))).toBe('BANK_CODE_INVALID');
  });
  it('分行必填（Q18）：空字串／空白／null／缺少、3 碼、含字母、5 碼 → BRANCH_CODE_INVALID', () => {
    for (const b of ['', '  ', null, undefined, '003', '00a7', '00370']) {
      expect(codeOf(() => parseAddBody({ ...good, branchCode: b as never }))).toBe('BRANCH_CODE_INVALID');
    }
    expect(parseAddBody({ ...good, branchCode: ' 0037　' }).branchCode).toBe('0037');
  });
  it('setPayout：預設 false；只接受布林，其他型別 → REQUEST_INVALID', () => {
    expect(parseAddBody(good).setPayout).toBe(false);
    expect(parseAddBody({ ...good, setPayout: true }).setPayout).toBe(true);
    expect(parseAddBody({ ...good, setPayout: undefined }).setPayout).toBe(false);
    for (const v of ['true', 1, null, {}]) expect(codeOf(() => parseAddBody({ ...good, setPayout: v }))).toBe('REQUEST_INVALID');
  });
  it('戶名：去頭尾（含全形）空白；空、只有空白、51 字、換行、控制字元 → ACCOUNT_HOLDER_INVALID；50 字與 emoji 以 code point 計', () => {
    expect(parseAddBody({ ...good, holder: '　王小明 ' }).holder).toBe('王小明');
    for (const h of ['', '   ', '　', 'a'.repeat(51), '王\n小明', '王\r小明', '王\u0007明', '王\u0085明']) {
      expect(codeOf(() => parseAddBody({ ...good, holder: h }))).toBe('ACCOUNT_HOLDER_INVALID');
    }
    expect(parseAddBody({ ...good, holder: 'a'.repeat(50) }).holder).toHaveLength(50);
    expect(parseAddBody({ ...good, holder: '😀'.repeat(50) }).holder).toBe('😀'.repeat(50));
    expect(codeOf(() => parseAddBody({ ...good, holder: '😀'.repeat(51) }))).toBe('ACCOUNT_HOLDER_INVALID');
  });
  it('錯誤訊息裡沒有帳號（AC-9 的單元版）', () => {
    for (const a of ['12345a78901', '1234567']) {
      try { parseAddBody({ ...good, account: a }); } catch (e) { expect(JSON.stringify([(e as Error).message, (e as BankError).code])).not.toContain(a); }
    }
  });
});

describe('AES-256-GCM（AC-6）', () => {
  it('加密後解得回來；密文不含明文；同一個帳號兩次密文不同（隨機 IV）', async () => {
    const a = await encryptAccount(KEY, '001234567890'), b = await encryptAccount(KEY, '001234567890');
    expect(a).not.toBe(b);
    expect(a).not.toContain('001234567890');
    expect(await decryptAccount(KEY, a)).toBe('001234567890');
    expect(await decryptAccount(KEY, b)).toBe('001234567890');
  });
  it('格式：base64(iv 12 ‖ 密文 ‖ tag 16)＝12 + 明文長度 + 16 bytes', async () => {
    const raw = atob(await encryptAccount(KEY, '001234567890'));
    expect(raw.length).toBe(12 + 12 + 16);
  });
  it('錯的金鑰或被竄改的密文解不開', async () => {
    const c = await encryptAccount(KEY, '001234567890');
    await expect(decryptAccount(new Uint8Array(32).fill(9), c)).rejects.toThrow();
    const raw = Uint8Array.from(atob(c), (x) => x.charCodeAt(0)); raw[14] ^= 1;
    await expect(decryptAccount(KEY, btoa(String.fromCharCode(...raw)))).rejects.toThrow();
  });
});

describe('parseKeyConfig（BANK_KEY_MISSING）', () => {
  it('合法：32 bytes；版本預設 1', () => {
    expect(parseKeyConfig(KEY_B64, undefined)).toEqual({ key: KEY, version: 1 });
    expect(parseKeyConfig(KEY_B64, '3').version).toBe(3);
  });
  it('缺、不是 base64、不是 32 bytes、版本不是正整數 → BANK_KEY_MISSING（500）', () => {
    for (const [k, v] of [[undefined, undefined], ['', undefined], ['@@@', undefined], [btoa('short'), undefined], [KEY_B64, 'x'], [KEY_B64, '0'], [KEY_B64, '1.5']] as const) {
      expect(codeOf(() => parseKeyConfig(k, v))).toBe('BANK_KEY_MISSING');
    }
    expect(() => parseKeyConfig(undefined, undefined)).toThrow(expect.objectContaining({ status: 500 }));
  });
});

describe('amr 解析（STEP_UP 的輸入）', () => {
  const jwt = (payload: unknown) => 'h.' + btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(payload)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') + '.s';
  it('取 method＝otp 的最新 timestamp（秒）→ ISO', () => {
    expect(latestOtpAt(jwt({ amr: [{ method: 'otp', timestamp: 1000 }, { method: 'password', timestamp: 5000 }, { method: 'otp', timestamp: 2000 }] })))
      .toBe(new Date(2000_000).toISOString());
  });
  it('沒有 otp、沒有 amr、amr 型別怪、timestamp 不是數字、JWT 壞掉 → null', () => {
    for (const p of [{ amr: [{ method: 'password', timestamp: 1 }] }, {}, { amr: 'otp' }, { amr: [{ method: 'otp' }] }, { amr: [{ method: 'otp', timestamp: '1' }] }, { amr: [null] }]) {
      expect(latestOtpAt(jwt(p))).toBeNull();
    }
    expect(latestOtpAt('not-a-jwt')).toBeNull();
    expect(latestOtpAt('a.b!.c')).toBeNull();
    expect(jwtPayload('')).toBeNull();
  });
  it('base64url 帶非 ASCII 的 payload 不會炸', () => {
    expect(jwtPayload(jwt({ x: '喵' }))).toEqual({ x: '喵' });
  });
});

describe('fingerprintAccount（T2：全站唯一，不含 userId）', () => {
  it('同銀行同帳號 → 相同；不同銀行或不同帳號 → 不同；64 位小寫 hex；不含明文', async () => {
    const a = await fingerprintAccount(KEY, '004', '001234567890');
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(await fingerprintAccount(KEY, '004', '001234567890')).toBe(a);
    expect(await fingerprintAccount(KEY, '005', '001234567890')).not.toBe(a);
    expect(await fingerprintAccount(KEY, '004', '001234567891')).not.toBe(a);
    expect(a).not.toContain('001234567890');
  });
  it('不同金鑰 → 不同（沒有金鑰就窮舉不了）；固定測試向量（Python hmac 獨立算出，防止演算法被默默改掉）', async () => {
    const a = await fingerprintAccount(KEY, '004', '001234567890');
    expect(await fingerprintAccount(new Uint8Array(32).fill(9), '004', '001234567890')).not.toBe(a);
    expect(a).toBe('3a4a83fba2ca736894d6da2729e6bad822f919bbd47c520ed812953c2044e65b');
  });
  it('分行不進比對：函式簽名只吃銀行代碼與帳號', async () => {
    expect(fingerprintAccount.length).toBe(3);
  });
});

describe('mapDbError：資料庫 hint → HTTP', () => {
  it('已知碼對應契約表', () => {
    const t: Record<string, number> = { NOT_AUTHENTICATED: 401, BANK_CODE_INVALID: 400, BRANCH_CODE_INVALID: 400, ACCOUNT_NUMBER_INVALID: 400, ACCOUNT_HOLDER_INVALID: 400, BANK_ACCOUNT_LIMIT: 409, BANK_ACCOUNT_DUPLICATE: 409, BANK_ACCOUNT_TAKEN: 409, PHONE_REQUIRED: 403, STEP_UP_REQUIRED: 403 };
    for (const [c, s] of Object.entries(t)) { const e = mapDbError(c); expect([e.code, e.status]).toEqual([c, s]); }
  });
  it('未知碼（含 NO_SHOP、原型鏈名稱、可能夾帶資料的資料庫原文）一律 INTERNAL 500，且不回傳原文', () => {
    for (const m of ['NO_SHOP', 'constructor', 'toString', 'duplicate key value (001234567890)', undefined, null, 42, '']) {
      const e = mapDbError(m);
      expect([e.code, e.status]).toEqual(['INTERNAL', 500]);
      expect(e.message).not.toContain('0012');
    }
  });
});
