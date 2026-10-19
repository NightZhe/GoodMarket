import { describe, expect, it } from 'vitest';
import type { SellerEcpayMerchantRow } from './types';
import { MERCHANT_STATE_TEXT, isValidMerchantId, merchantStateOf, merchantErrorText } from './merchant';

const row = (status: SellerEcpayMerchantRow['status'], reason: string | null = null): SellerEcpayMerchantRow => ({
  shop_id: 's', ecpay_merchant_id: '3002607', status, reason, created_at: 'x', updated_at: 'x', activated_at: null,
});

describe('merchantStateOf：資料列 → 四態（沒有資料列＝未開通）', () => {
  it('沒有資料列是未開通', () => expect(merchantStateOf(null)).toBe('none'));
  it('四種資料庫狀態各自對應', () => {
    expect(merchantStateOf(row('pending_review'))).toBe('review');
    expect(merchantStateOf(row('active'))).toBe('active');
    expect(merchantStateOf(row('rejected', '資料不符'))).toBe('rejected');
  });
  it('suspended（設計沒有的第五種）：歸在被退回那一型，附原因，不會被當成可收款', () => {
    expect(merchantStateOf(row('suspended', '停用'))).toBe('suspended');
    expect(MERCHANT_STATE_TEXT.suspended.title).toBeTruthy();
  });
});

describe('MERCHANT_STATE_TEXT：每個狀態都有文案', () => {
  it('標題與說明句不為空，也不寫天數（未查證）', () => {
    for (const s of ['none', 'review', 'active', 'rejected', 'suspended'] as const) {
      const t = MERCHANT_STATE_TEXT[s];
      expect(t.title, s).toBeTruthy();
      expect(t.lead, s).toBeTruthy();
      expect(t.lead + t.title, s).not.toMatch(/\d+\s*(天|日)/);
    }
  });
});

describe('isValidMerchantId：特約商店編號 7～10 位數字（與資料庫檢查一致）', () => {
  it.each([['3002607', true], ['2000132', true], ['1234567890', true], ['123456', false], ['12345678901', false], ['30026a7', false], ['', false], [' 3002607', false]])('%s → %s', (v, ok) => {
    expect(isValidMerchantId(v)).toBe(ok);
  });
});

describe('merchantErrorText', () => {
  it('四個資料庫錯誤碼各有說明', () => {
    for (const code of ['NO_SHOP', 'MERCHANT_ID_INVALID', 'MERCHANT_ID_TAKEN', 'MERCHANT_ALREADY_ACTIVE']) {
      expect(merchantErrorText(code, 'fallback'), code).not.toBe('fallback');
    }
    expect(merchantErrorText('WHATEVER', 'fallback')).toBe('fallback');
    expect(merchantErrorText(null, 'fallback')).toBe('fallback');
  });
});
