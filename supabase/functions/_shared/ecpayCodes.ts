// 綠界授權回應代碼分類（35630、35601 文件列出的常見代碼；完整表在綠界廠商後台，文件不給）。
export type AuthCodeClass = 'authorized' | 'unknown' | 'card_invalid' | 'declined';

export function classifyAuthCode(rtnCode: number): AuthCodeClass {
  if (rtnCode === 1) return 'authorized';
  if (rtnCode === 10300066) return 'unknown';                                  // 交易付款結果待確認中
  if (rtnCode === 10100251 || rtnCode === 10100255 || rtnCode === 10100256) return 'card_invalid'; // 過期／掛失／盜用：不可再對同一個 BindCardID 授權
  return 'declined';
}

const GENERIC = '這張卡這次授權沒有成功，請換一張卡或稍後再試。';
const MESSAGES: Record<number, string> = {
  10100248: '發卡銀行拒絕了這筆交易，請聯絡發卡銀行確認原因，或換一張卡。',
  10100252: '這張卡的額度或餘額不足，請換一張卡。',
  10100254: '這張卡有交易限制，請聯絡發卡銀行，或換一張卡。',
  10100251: '這張卡已失效或過期，請換一張卡，並刪除這張。',
  10100255: '這張卡已失效，請換一張卡，並刪除這張。',
  10100256: '這張卡已失效，請換一張卡，並刪除這張。',
};

export const userMessageForDecline = (rtnCode: number | null | undefined): string =>
  (rtnCode != null && MESSAGES[rtnCode]) || GENERIC;
