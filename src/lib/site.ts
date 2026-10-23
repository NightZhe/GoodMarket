// 站台層級的常數：登入相關的儲存鍵與待使用者提供的聯絡資訊，集中一處。

/** 舊版結帳頁記住的收件資料。新版不再讀寫，啟動時與登出時都會清掉（R-A10、R-A13） */
export const BUYER_KEY = 'goodmarket_buyer';

/** 隱私政策與帳號頁的聯絡信箱（使用者確認，會公開顯示） */
export const CONTACT_EMAIL = 'zerozhe588@gmail.com';
/** 隱私政策生效日期（使用者提供）。每次修訂政策時改成推前端那天；修訂紀錄的最新一筆用它，舊的修訂各自有固定日期常數（Privacy.tsx），不會跟著變 */
export const PRIVACY_EFFECTIVE = '2026/10/24';
/** 隱私政策第一版發佈日（Google、Apple 登入），修訂紀錄最後一筆；不會再變 */
export const PRIVACY_FIRST_PUBLISHED = '2026/10/17';
/** 申請刪除帳號後，多久內刪除或去識別化個人資料（使用者拍板：帳號存在期間保存；申請刪除後 1 年內處理） */
export const DELETION_WINDOW = '1 年內';
