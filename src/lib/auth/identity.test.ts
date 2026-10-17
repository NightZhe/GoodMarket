import { describe, expect, it } from 'vitest';
import { accountLabel, loginProviderOf, nicknamePrefillFor, prefillNickname, PRIVATE_RELAY_LABEL, signedInText } from './identity';
import { PREFILL_VECTORS } from '../reviews/nickname-prefill-vectors';
import { validateNickname } from '../reviews/nickname';

describe('暱稱預填：與資料庫共用的測試向量', () => {
  it('向量檔有 22 筆', () => expect(PREFILL_VECTORS).toHaveLength(22));

  it.each(PREFILL_VECTORS.map(v => [`${v.provider} ${JSON.stringify(v.full_name ?? v.name ?? null)}`, v] as const))('%s', (_l, v) => {
    expect(prefillNickname({ provider: v.provider, full_name: v.full_name, name: v.name }), v.note).toBe(v.expect);
  });

  it('非空的預填結果一定通得過暱稱驗證（使用者不改也能送出）', () => {
    for (const v of PREFILL_VECTORS) {
      const got = prefillNickname({ provider: v.provider, full_name: v.full_name, name: v.name });
      if (got) expect(validateNickname(got)).toEqual({ ok: true, value: got });
    }
  });

  it('full_name 不是字串時不當機', () => {
    expect(prefillNickname({ provider: 'google', full_name: 123, name: null })).toBe('');
    expect(prefillNickname({ provider: 'google' })).toBe('');
  });
});

const google = { email: 'a@gmail.com', app_metadata: { provider: 'google' }, user_metadata: { full_name: 'Harry Lee' }, identities: [{ provider: 'google', last_sign_in_at: '2026-10-17T00:00:00Z', identity_data: { full_name: 'Harry Lee' } }] };
const apple = { email: 'x@privaterelay.appleid.com', app_metadata: { provider: 'apple' }, identities: [{ provider: 'apple', last_sign_in_at: '2026-10-17T00:00:00Z' }] };

describe('nicknamePrefillFor', () => {
  it('Google：預填，名稱被調整時標記 adjusted（畫面要說明）', () => {
    expect(nicknamePrefillFor(google)).toEqual({ value: 'HarryLee', original: 'Harry Lee', adjusted: true });
  });
  it('名稱本來就合法：不標記調整', () => {
    expect(nicknamePrefillFor({ ...google, identities: [{ provider: 'google', identity_data: { full_name: '李宗哲' } }] })).toEqual({ value: '李宗哲', original: '李宗哲', adjusted: false });
  });
  it('Apple、email 帳號、沒登入：不預填', () => {
    expect(nicknamePrefillFor(apple)).toBeNull();
    expect(nicknamePrefillFor({ email: 'a@b.c', app_metadata: { provider: 'email' }, user_metadata: { full_name: '王小明' } })).toBeNull();
    expect(nicknamePrefillFor(null)).toBeNull();
  });
  it('處理後不足 2 字：不預填', () => {
    expect(nicknamePrefillFor({ ...google, identities: [{ provider: 'google', identity_data: { full_name: 'やまだ' } }] })).toBeNull();
  });
  it('email 帳號後來合併了 Google 身分：用 Google 身分自己的名稱', () => {
    const merged = { email: 'a@gmail.com', app_metadata: { provider: 'email' }, user_metadata: { full_name: '別人' }, identities: [{ provider: 'email' }, { provider: 'google', identity_data: { name: '陳小美' } }] };
    expect(nicknamePrefillFor(merged)?.value).toBe('陳小美');
  });
  it('沒有 identities 時退回 app_metadata／user_metadata', () => {
    expect(nicknamePrefillFor({ app_metadata: { provider: 'google' }, user_metadata: { name: 'Bob Smith' } })?.value).toBe('BobSmith');
  });
});

describe('loginProviderOf', () => {
  it('單一身分', () => { expect(loginProviderOf(google)).toBe('google'); expect(loginProviderOf(apple)).toBe('apple'); });
  it('合併帳號看最近登入的身分，不是最早建立的', () => {
    expect(loginProviderOf({ app_metadata: { provider: 'email' }, identities: [
      { provider: 'email', last_sign_in_at: '2026-01-01T00:00:00Z' }, { provider: 'google', last_sign_in_at: '2026-10-01T00:00:00Z' }] })).toBe('google');
  });
  it('沒有 identities 退回 app_metadata；都沒有是 other', () => {
    expect(loginProviderOf({ app_metadata: { provider: 'email' } })).toBe('email');
    expect(loginProviderOf({})).toBe('other');
  });
});

describe('accountLabel：沒有 email 或隱藏信箱時不能顯示空白', () => {
  it('一般 email 原樣顯示', () => expect(accountLabel(google)).toBe('a@gmail.com'));
  it('Apple 隱藏信箱', () => expect(accountLabel(apple)).toBe(PRIVATE_RELAY_LABEL));
  it('Apple 沒有 email', () => expect(accountLabel({ ...apple, email: null })).toBe(PRIVATE_RELAY_LABEL));
  it('其他方式沒有 email', () => expect(accountLabel({ email: '', app_metadata: { provider: 'google' } })).toBe('已登入的帳號'));
});

describe('signedInText', () => {
  it('一般 email', () => {
    expect(signedInText(google)).toBe('以 a@gmail.com 登入');
    expect(signedInText(google, true)).toBe('以 a@gmail.com 登入中');
  });
  it('Apple 隱藏信箱用固定說法，不留空白', () => {
    expect(signedInText(apple)).toBe('以 Apple 帳號登入（已隱藏電子郵件）');
    expect(signedInText(apple, true)).toBe('以 Apple 帳號（已隱藏電子郵件）登入中');
  });
});
