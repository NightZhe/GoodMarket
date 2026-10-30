import { describe, expect, it } from 'vitest';
import { parseConfig } from './env.ts';

// 平台收款（PR-乙）：綠界帳戶類型由 secret 決定（spec §4 S-5；decisions E1＝A：缺設或值錯一律拒絕啟動，fail closed）
const BASE: Record<string, string> = {
  SUPABASE_URL: 'http://127.0.0.1:56321', SUPABASE_SERVICE_ROLE_KEY: 'svc', SUPABASE_ANON_KEY: 'anon',
  PAYMENT_FUNCTIONS_BASE_URL: 'http://127.0.0.1:56321/functions/v1/', PAYMENT_SITE_URL: 'http://localhost:5173/',
  ECPAY_HASH_KEY: 'pwFHCqoQZGmho4w6', ECPAY_HASH_IV: 'EkRm7iFT261dpevs', ECPAY_MERCHANT_ID: '3002607',
};
const get = (env: Record<string, string | undefined>) => (k: string) => env[k];

describe('parseConfig：綠界帳戶類型（E1 fail closed）', () => {
  it('ECPAY_ACCOUNT_TYPE 沒設 → 丟錯（不打綠界）', () => {
    expect(() => parseConfig(get(BASE))).toThrow(/ECPAY_ACCOUNT_TYPE/);
  });
  it.each(['Merchant', 'seller', '', 'both'])('ECPAY_ACCOUNT_TYPE=%j 不是 merchant／platform → 丟錯', (v) => {
    expect(() => parseConfig(get({ ...BASE, ECPAY_ACCOUNT_TYPE: v }))).toThrow(/ECPAY_ACCOUNT_TYPE/);
  });
  it('merchant：不帶平台商編號，外層與交易都用本站商店編號；綁卡也用同一個', () => {
    const c = parseConfig(get({ ...BASE, ECPAY_ACCOUNT_TYPE: 'merchant' }));
    expect(c.accountType).toBe('merchant');
    expect(c.ecpay.merchantId).toBe('3002607');
    expect(c.ecpay.platformId).toBeUndefined();
    expect(c.ecpay.hashKey).toBe('pwFHCqoQZGmho4w6');
    expect(c.ecpay.payReturnUrl).toBe('http://127.0.0.1:56321/functions/v1/payment-pay-return');
  });
  it('merchant：有設 ECPAY_PLATFORM_ID 也不用（一般特店不帶 PlatformID，R12）', () => {
    const c = parseConfig(get({ ...BASE, ECPAY_ACCOUNT_TYPE: 'merchant', ECPAY_PLATFORM_ID: '3003008' }));
    expect(c.ecpay.platformId).toBeUndefined();
  });
  it('platform：必須有 ECPAY_PLATFORM_ID，交易用的特店是 ECPAY_MERCHANT_ID', () => {
    expect(() => parseConfig(get({ ...BASE, ECPAY_ACCOUNT_TYPE: 'platform' }))).toThrow(/ECPAY_PLATFORM_ID/);
    const c = parseConfig(get({ ...BASE, ECPAY_ACCOUNT_TYPE: 'platform', ECPAY_PLATFORM_ID: '3003008' }));
    expect(c.accountType).toBe('platform');
    expect(c.ecpay.platformId).toBe('3003008');
    expect(c.ecpay.merchantId).toBe('3002607');
  });
  it('ECPAY_MERCHANT_ID 缺或格式不對（7～10 位數字）→ 丟錯', () => {
    expect(() => parseConfig(get({ ...BASE, ECPAY_ACCOUNT_TYPE: 'merchant', ECPAY_MERCHANT_ID: undefined }))).toThrow(/ECPAY_MERCHANT_ID/);
    expect(() => parseConfig(get({ ...BASE, ECPAY_ACCOUNT_TYPE: 'merchant', ECPAY_MERCHANT_ID: '30026' }))).toThrow(/ECPAY_MERCHANT_ID/);
    expect(() => parseConfig(get({ ...BASE, ECPAY_ACCOUNT_TYPE: 'merchant', ECPAY_MERCHANT_ID: 'abc3002607' }))).toThrow(/ECPAY_MERCHANT_ID/);
  });
  it('舊 secret ECPAY_BIND_MERCHANT_ID 不再使用：設了也不會變成另一個綁卡特店', () => {
    const c = parseConfig(get({ ...BASE, ECPAY_ACCOUNT_TYPE: 'merchant', ECPAY_BIND_MERCHANT_ID: '2000132' }));
    expect(c.ecpay.merchantId).toBe('3002607');
    expect('bindMerchantId' in c).toBe(false);
  });
  it('ECPAY_ENV 只接受 stage／prod，預設 stage；綁卡金額預設 500', () => {
    const c = parseConfig(get({ ...BASE, ECPAY_ACCOUNT_TYPE: 'merchant' }));
    expect(c.ecpay.env).toBe('stage');
    expect(c.bindAmount).toBe(500);
    expect(() => parseConfig(get({ ...BASE, ECPAY_ACCOUNT_TYPE: 'merchant', ECPAY_ENV: 'live' }))).toThrow(/ECPAY_ENV/);
  });
});
