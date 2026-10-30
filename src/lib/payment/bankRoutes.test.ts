import { describe, expect, it } from 'vitest';
import { flowBase, pageABank, pageAPath, safeBankReturn, verifyPath } from './bankRoutes';

describe('銀行帳號路由', () => {
  it('兩個入口各有自己的頁 A 與流程路徑', () => {
    expect(pageAPath('account')).toBe('/account/payment-methods');
    expect(pageAPath('seller')).toBe('/seller/payout');
    expect(pageABank('seller')).toBe('/seller/payout?section=bank');
    expect(flowBase('account')).toBe('/account/bank-accounts');
    expect(flowBase('seller')).toBe('/seller/payout/bank-accounts');
  });
  it('簡訊驗證路徑帶用途與帳號 id', () => {
    expect(verifyPath('account', 'add')).toBe('/account/bank-accounts/verify?for=add');
    expect(verifyPath('seller', 'payout', 'a b')).toBe('/seller/payout/bank-accounts/verify?for=payout&id=a%20b');
  });
  it('綁定手機的回跳只接受兩個頁 A', () => {
    expect(safeBankReturn('/account/payment-methods')).toBe('/account/payment-methods');
    expect(safeBankReturn('/seller/payout')).toBe('/seller/payout');
    for (const bad of ['https://evil.example', '//evil.example', '/account', '/account/payment-methods/new', null, 5, undefined]) expect(safeBankReturn(bad)).toBeNull();
  });
});
