// 銀行帳號頁的路由。頁 A 有兩個入口（帳號頁、賣家中心），新增流程（選銀行、填資料、簡訊驗證）跟著入口走，
// 這樣從賣家中心進來的人整個流程都在賣家中心的版面裡，完成後回到賣家中心。

export type BankOrigin = 'account' | 'seller';

/** 頁 A「銀行帳號／信用卡」 */
export const pageAPath = (o: BankOrigin): string => (o === 'seller' ? '/seller/payout' : '/account/payment-methods');
/** 頁 A 直接捲到銀行帳號區 */
export const pageABank = (o: BankOrigin): string => `${pageAPath(o)}?section=bank`;
/** 新增流程的父路徑；底下是 new（頁 C）、new/bank（頁 B）、verify（簡訊） */
export const flowBase = (o: BankOrigin): string => (o === 'seller' ? '/seller/payout/bank-accounts' : '/account/bank-accounts');

export type VerifyPurpose = 'add' | 'payout';
export const verifyPath = (o: BankOrigin, purpose: VerifyPurpose, id?: string): string =>
  `${flowBase(o)}/verify?for=${purpose}${id ? `&id=${encodeURIComponent(id)}` : ''}`;

/** 綁定手機頁綁完要回哪裡：只接受這兩個頁 A，其他一律當作沒有（不讓網址或 state 把人導去任意位置） */
export function safeBankReturn(v: unknown): string | null {
  return v === pageAPath('account') || v === pageAPath('seller') ? v : null;
}

/** 頁 A 進流程時帶的 navigation state：流程第一頁前面就是頁 A，結束時可以直接退回去，不在歷史裡留一份重複的 A */
export const FROM_A = { fromA: true } as const;
