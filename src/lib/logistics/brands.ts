// 退貨門市的超商品牌。資料庫存代碼（interface-logistics.md 第 1 節），畫面字樣在這裡對照（決策 N7），改字樣不用動資料。

export const BRAND_OPTIONS = [
  { code: 'seven_eleven', label: '7-ELEVEN' },
  { code: 'familymart', label: '全家' },
  { code: 'hilife', label: '萊爾富' },
  { code: 'okmart', label: 'OKmart' },
] as const;

export type BrandCode = (typeof BRAND_OPTIONS)[number]['code'];

export const isBrandCode = (v: string): v is BrandCode => BRAND_OPTIONS.some(b => b.code === v);

/** 代碼 → 畫面字樣；不認得的代碼照原樣顯示（不丟錯，也不顯示空白） */
export const brandLabel = (code: string): string => BRAND_OPTIONS.find(b => b.code === code)?.label ?? code;
