import { describe, expect, it } from 'vitest';
import { accountLabel, loginProviderOf, nicknamePrefillFor, phoneOf, prefillNickname, PRIVATE_RELAY_LABEL, providerLabel, signedInText } from './identity';
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

// ───────── 手機帳號（R-26）：資料形狀來自 t2-local-tests.md F-4、F-11 的實測 ─────────
const phoneOnly = {
  email: '', phone: '886912345678', app_metadata: { provider: 'phone' },
  identities: [{ provider: 'phone', last_sign_in_at: '2026-10-18T00:00:00Z' }],
};
const googlePlusPhone = {
  email: 'a@gmail.com', phone: '886912345678', app_metadata: { provider: 'google' },
  identities: [
    { provider: 'google', last_sign_in_at: '2026-10-17T00:00:00Z' },
    { provider: 'phone', last_sign_in_at: '2026-10-10T00:00:00Z' },
  ],
};

describe('loginProviderOf：手機', () => {
  it('只有手機身分 → phone（沒有 amr 也認得）', () => {
    expect(loginProviderOf(phoneOnly)).toBe('phone');
  });
  it('簡訊登入不會更新手機身分的 last_sign_in_at，所以有 amr 就以 amr 為準：otp → phone', () => {
    // 不看 amr 會得到 google（Google 身分的時間比較新）——這就是 F-4 的問題
    expect(loginProviderOf(googlePlusPhone)).toBe('google');
    expect(loginProviderOf(googlePlusPhone, [{ method: 'otp', timestamp: 1 }])).toBe('phone');
  });
  it('amr oauth → 看 Google／Apple 身分，不會被手機身分搶走', () => {
    expect(loginProviderOf(googlePlusPhone, [{ method: 'oauth', timestamp: 1 }])).toBe('google');
    const appleAndGoogle = { identities: [
      { provider: 'google', last_sign_in_at: '2026-10-01T00:00:00Z' }, { provider: 'apple', last_sign_in_at: '2026-10-18T00:00:00Z' }, { provider: 'phone' }] };
    expect(loginProviderOf(appleAndGoogle, [{ method: 'oauth' }])).toBe('apple');
  });
  it('amr password → email（步驟 6 之前留下的 Email session）', () => {
    expect(loginProviderOf({ email: 'a@b.c', identities: [{ provider: 'email' }] }, [{ method: 'password' }])).toBe('email');
  });
  it('amr 有好幾筆：取時間最新的那一筆', () => {
    expect(loginProviderOf(googlePlusPhone, [{ method: 'oauth', timestamp: 100 }, { method: 'otp', timestamp: 200 }])).toBe('phone');
    expect(loginProviderOf(googlePlusPhone, [{ method: 'otp', timestamp: 100 }, { method: 'oauth', timestamp: 200 }])).toBe('google');
  });
  it('amr 空陣列、null、不認得的方法 → 退回看身分', () => {
    expect(loginProviderOf(googlePlusPhone, [])).toBe('google');
    expect(loginProviderOf(googlePlusPhone, null)).toBe('google');
    expect(loginProviderOf(googlePlusPhone, [{ method: 'totp' }])).toBe('google');
  });
  it('providerLabel', () => {
    expect(providerLabel('phone')).toBe('手機');
    expect(providerLabel('google')).toBe('Google');
  });
});

describe('accountLabel／signedInText：手機', () => {
  it('手機帳號（email 是空字串）顯示遮罩門號，不是「已登入的帳號」', () => {
    expect(accountLabel(phoneOnly)).toBe('0912-***-678');
    expect(signedInText(phoneOnly)).toBe('以 0912-***-678 登入');
    expect(signedInText(phoneOnly, true)).toBe('以 0912-***-678 登入中');
  });
  it('Google＋手機：用 Google 登入顯示 email；改用手機登入顯示遮罩門號', () => {
    expect(accountLabel(googlePlusPhone)).toBe('a@gmail.com');
    expect(accountLabel(googlePlusPhone, 'phone')).toBe('0912-***-678');
    expect(signedInText(googlePlusPhone, true, 'phone')).toBe('以 0912-***-678 登入中');
  });
  it('Apple 隱藏信箱＋手機、用 Apple 登入：照舊用固定說法', () => {
    expect(accountLabel({ ...apple, phone: '886912345678' })).toBe(PRIVATE_RELAY_LABEL);
  });
  it('門號不是台灣行動門號：不顯示號碼', () => {
    expect(accountLabel({ email: '', phone: '85291234567', app_metadata: { provider: 'phone' }, identities: [{ provider: 'phone' }] })).toBe('已登入的帳號');
  });
});

describe('phoneOf', () => {
  it('讀 user.phone（不含 +）', () => {
    expect(phoneOf(phoneOnly)).toBe('0912345678');
    expect(phoneOf({ phone: '' })).toBeNull();
    expect(phoneOf({})).toBeNull();
  });
});

describe('loginProviderOf：綁定手機後的那個 session', () => {
  // 驗證綁定的驗證碼會換發一個新的 session（amr 是 otp），但使用者其實一直是用 Google 登入的
  const bound = { ...googlePlusPhone };
  const otpAt = 1_700_000_000; // amr 的 timestamp 是秒
  it('amr 是 otp、而且是剛綁定完（15 秒內）→ 維持綁定前的登入方式', () => {
    expect(loginProviderOf(bound, [{ method: 'otp', timestamp: otpAt }], { provider: 'google', at: otpAt * 1000 + 3_000 })).toBe('google');
  });
  it('之後使用者真的用簡訊登入（時間差很多）→ 手機', () => {
    expect(loginProviderOf(bound, [{ method: 'otp', timestamp: otpAt + 3600 }], { provider: 'google', at: otpAt * 1000 })).toBe('phone');
  });
  it('沒有紀錄或 amr 不是 otp → 照 amr', () => {
    expect(loginProviderOf(bound, [{ method: 'otp', timestamp: otpAt }], null)).toBe('phone');
    expect(loginProviderOf(bound, [{ method: 'oauth', timestamp: otpAt }], { provider: 'apple', at: otpAt * 1000 })).toBe('google');
  });
});
