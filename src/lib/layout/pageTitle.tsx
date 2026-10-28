import { createContext, useContext, useLayoutEffect } from 'react';

/**
 * 頁面對外框宣告「我自己有可見的 h1」。外框（BuyerLayout）在側邊姿態沒有導覽列時會在內容頂端補一個行內標題（headerKind 的 title），
 * 頁面自己已經有標題的狀態（結帳成功「訂單成立！」、下單失敗、登入閘門）要宣告，外框就不畫，同一頁只留一個 h1。
 * 這是明示的宣告，不靠外框去偷看頁面的 DOM 或 class 名。
 * Provider 外（賣家頁、網頁版其他外框）呼叫是空動作，所以共用元件（登入閘門）可以放心呼叫。
 */
const OwnTitleContext = createContext<(delta: 1 | -1) => void>(() => {});

export const OwnTitleProvider = OwnTitleContext.Provider;

/** active＝這個畫面目前有顯示自己的 h1。在 layout effect 裡登記，第一次繪製前外框就知道，不會閃出兩個標題 */
export function useOwnsPageTitle(active = true): void {
  const report = useContext(OwnTitleContext);
  useLayoutEffect(() => {
    if (!active) return;
    report(1);
    return () => report(-1);
  }, [active, report]);
}
