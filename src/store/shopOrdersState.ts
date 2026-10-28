import type { OrdersState } from './useAccountOrders';

/** 賣家訂單讀取的事件：start＝一次讀取送出；ok／fail＝結果；reset＝登出或換帳號 */
export type ShopOrdersEvent = 'start' | 'ok' | 'fail' | 'reset';

/**
 * 賣家訂單讀取狀態（語意照買家端 OrdersState）。
 * 只有「還沒成功過」才會是 loading／error；成功過（ready）之後的任何重讀都不改狀態，失敗也維持 ready，
 * 畫面保留舊資料、不打擾。從 error 重試時保持 error 直到結果回來，畫面才能留在「重試中…」而不是跳去載入態。
 */
export function nextShopOrdersState(prev: OrdersState, event: ShopOrdersEvent): OrdersState {
  switch (event) {
    case 'reset': return 'idle';
    case 'ok': return 'ready';
    case 'start': return prev === 'idle' ? 'loading' : prev;
    case 'fail': return prev === 'ready' ? 'ready' : 'error';
  }
}
