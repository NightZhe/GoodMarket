// 新增、設為撥款帳號完成後，流程頁把「要顯示的 toast 與要聚焦的列」交給頁 A。
// 只放在記憶體（模組變數）：重新整理就沒了，也不會寫進網址或儲存空間；內容只有一句話與帳號 id，沒有任何帳號資料。

export interface BankDone { toast: string; kind?: 'success' | 'info'; focusId: string | null }

let pending: BankDone | null = null;

export const setBankDone = (d: BankDone): void => { pending = d; };
/** 讀但不清（React 開發模式會呼叫兩次初始化函式）；顯示後再 clearBankDone */
export const peekBankDone = (): BankDone | null => pending;
export const clearBankDone = (): void => { pending = null; };
