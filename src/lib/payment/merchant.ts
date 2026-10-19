import type { SellerEcpayMerchantRow } from './types';

// 賣家收款帳戶（P-C）。狀態由維運人員在綠界後台核對後改資料庫（綠界沒有查詢特約商店狀態的 API）。
// 文案：設計 11.3。不寫天數、不寫撥款時程（都未查證）。

export type MerchantState = 'none' | 'review' | 'active' | 'rejected' | 'suspended';

export function merchantStateOf(row: SellerEcpayMerchantRow | null): MerchantState {
  if (!row) return 'none';
  switch (row.status) {
    case 'pending_review': return 'review';
    case 'active': return 'active';
    case 'rejected': return 'rejected';
    case 'suspended': return 'suspended';
  }
}

export interface MerchantText { title: string; lead: string }

export const MERCHANT_STATE_TEXT: Record<MerchantState, MerchantText> = {
  none: { title: '未開通', lead: '買家目前只能用貨到付款向你購買。' },
  review: { title: '審核中', lead: '綠界科技正在審核你的資料。審核期間，買家只能用貨到付款。' },
  active: { title: '可收款', lead: '買家可以用信用卡向你付款，款項由綠界科技處理並撥給你。' },
  rejected: { title: '被退回', lead: '綠界科技退回了你的資料，修正後會再審核。在那之前，買家只能用貨到付款。' },
  // 設計稿沒有這一態：資料庫有 suspended。沿用被退回的版型，文字照實說「已停用」
  suspended: { title: '已停用', lead: '你的線上收款已被停用。在恢復之前，買家只能用貨到付款。' },
};

/** 特約商店編號：7～10 位數字（資料庫 submit_seller_ecpay_merchant 同一條規則） */
export const isValidMerchantId = (v: string): boolean => /^[0-9]{7,10}$/.test(v);

const MERCHANT_ERROR_TEXT: Record<string, string> = {
  NO_SHOP: '你還沒有開店，開店之後才能填寫。',
  MERCHANT_ID_INVALID: '特約商店編號要是 7 到 10 位數字。',
  MERCHANT_ID_TAKEN: '這個特約商店編號已經被其他商店使用。',
  MERCHANT_ALREADY_ACTIVE: '你的商店已經開通收款，不需要再填寫。',
};

export const merchantErrorText = (code: string | null, fallback: string): string => (code && MERCHANT_ERROR_TEXT[code]) || fallback;
