// 檢舉原因與固定文案的單一來源（spec §7.3、§7.4）。代碼要和資料庫 submit_report 的 p_reason 一致。

export const REPORT_REASONS = [
  { code: 'prohibited', label: '違禁或違法商品', hint: '例如毒品、武器、未經許可的藥品' },
  { code: 'counterfeit', label: '仿冒品或侵權', hint: '冒用品牌、盜用他人照片或著作' },
  { code: 'scam', label: '詐騙或不實資訊', hint: '價格、規格、描述與實際不符，或疑似詐騙' },
  { code: 'offensive', label: '色情、暴力或令人不適', hint: '圖片或文字含色情、血腥、暴力' },
  { code: 'harassment', label: '騷擾、仇恨或洩露個資', hint: '人身攻擊、歧視言論、公開他人個人資料' },
  { code: 'other', label: '其他', hint: '請在說明中簡單描述' },
] as const;

export type ReportReason = (typeof REPORT_REASONS)[number]['code'];

export type ReportTargetType = 'product' | 'review' | 'shop';

/** 說明欄上限（以 code point 計，去前後空白之後） */
export const REPORT_DETAILS_MAX = 200;

export const REPORT_TITLE: Record<ReportTargetType, string> = {
  product: '檢舉商品',
  review: '檢舉評價',
  shop: '檢舉店家',
};

export const REPORT_ASSURANCE = '我們會在 2 個工作天內處理，檢舉人身分不會告訴對方。';
export const REPORT_DONE_TITLE = '已收到檢舉，謝謝你';
export const REPORT_DONE_BODY = '我們會在 2 個工作天內處理；違反規定的內容會被移除。';
