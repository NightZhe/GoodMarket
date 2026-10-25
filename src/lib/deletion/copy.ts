import { DELETION_WINDOW } from '../site';

// 申請頁的逐字文案（design.md §2；全部待使用者上線前確認）。期限一律用 DELETION_WINDOW 組出，不寫死。

export const INTRO = `你可以在這裡申請刪除你的好物集帳號。我們會在 ${DELETION_WINDOW}人工處理，處理完成後無法復原。`;

export const SECTIONS: readonly { title: string; body: string }[] = [
  { title: '會刪除的資料', body: '你的帳號與所有登入方式（Google、Apple、手機號碼）、購物車、個人檔案（暱稱）、地址簿。' },
  {
    title: '會保留的資料',
    body: '訂單交易紀錄會依相關法規規定的期間保存，但不再連結到你的帳號。你寫過的評價會保留內容、星等與照片，名稱改為『匿名買家』：評價是其他買家參考的購物資訊，也影響賣家的評分。',
  },
  {
    title: '完成後怎麼知道',
    body: '刪除完成後，這個帳號就不存在了：再用同一個 Google、Apple 帳號或手機號碼登入，會是一個全新的空帳號。如果你的帳號有可收信的 email，我們也會寄信告訴你。',
  },
  { title: '處理期間', body: '申請後帳號仍可使用；如果在處理前又下單，我們會等訂單完成後才刪除。' },
];

export const SHOP_NOTE = '刪除帳號時，你的店、所有商品，以及店內的全部訂單與評價會一併刪除，向你購買過的買家也將看不到這些訂單。';

export const confirmApplyText = (hasShop: boolean) =>
  `我們會在 ${DELETION_WINDOW}刪除你的帳號，刪除後無法復原。處理完成前，你可以隨時取消申請。${hasShop ? '你的店、商品與店內的訂單也會一併刪除。' : ''}`;

export const buyerOrdersTitle = (n: number) => `你還有 ${n} 筆待出貨或運送中的訂單`;
export const shopOrdersTitle = (n: number) => `你的店還有 ${n} 筆待出貨或運送中的訂單`;
