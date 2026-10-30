/**
 * App 殼要不要替「賣家頁」把 body 往下推一個安全區（html.native-no-sticky）。
 * 賣家中心（SellerLayout）自己有一條蓋住狀態列的色帶，所以只有「賣家路由、但沒有賣家外框」的畫面（賣家登入頁、開店表單）才需要殼補。
 * 以前用「有沒有 header.sticky」判斷，頂欄拿掉後所有賣家頁都會被誤判成沒有外框，所以改看外框自己掛的 data-seller-layout 標記。
 */
export const SELLER_LAYOUT_MARK = 'data-seller-layout';

export const needsShellInset = (hash: string, hasSellerLayout: boolean): boolean =>
  /^#\/seller(\/|$)/.test(hash) && !hasSellerLayout;
