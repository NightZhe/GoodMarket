// 綠界站內付 SDK 的欄位無障礙（AC-B22）。查證（本機實測）：欄位是 SDK 畫進我們頁面的同頁 DOM，不是 iframe，
// 所以我們可以補程式化標籤。SDK 的輸入框沒有 <label>、沒有 aria-label，旁邊的「信用卡號」等只是一般文字，讀屏只會念 placeholder。

/** SDK 輸入框的 class → 讀屏名稱。class 都以 ecpay- 開頭 */
export const ECPAY_FIELD_LABELS: Record<string, string> = {
  'ecpay-cc-card': '信用卡號',
  'ecpay-date': '有效期限，月份和年份',
  'ecpay-cc-cvc': '安全碼',
  'ecpay-cardholderName': '持卡人姓名，卡片上的英文姓名',
};

interface Labelable { setAttribute(k: string, v: string): void; hasAttribute(k: string): boolean }

/** 替已經畫出來的欄位補上 aria-label（綠界自己有給的不覆蓋）。回傳這次補了幾個；欄位還沒畫出來就跳過 */
export function labelEcpayFields(root: { querySelector(sel: string): Labelable | null }): number {
  let n = 0;
  for (const [cls, label] of Object.entries(ECPAY_FIELD_LABELS)) {
    const el = root.querySelector(`.${cls}`);
    if (!el) continue;
    if (!el.hasAttribute('aria-label')) el.setAttribute('aria-label', label);
    n++;
  }
  return n;
}
