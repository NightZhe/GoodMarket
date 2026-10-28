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

/** 一次讀取的結果被寫入搶先丟掉時，最多再重讀幾次（超過就當讀不到，不能讓畫面永遠停在載入態） */
export const SHOP_ORDERS_MAX_REREADS = 3;

/**
 * 讀取結果被寫入搶先丟掉之後的下一步。
 * keep：已讀到過，畫面有舊資料可看，維持現況（序號保護不變）；
 * reread：還沒讀到過、重讀次數未滿上限，再讀一次；
 * fail：還沒讀到過、重讀已達上限（寫入一直在推進序號），當作讀不到，交給「重試」。
 */
export function afterStaleRead(state: OrdersState, rereads: number): 'keep' | 'reread' | 'fail' {
  if (state === 'ready') return 'keep';
  return rereads < SHOP_ORDERS_MAX_REREADS ? 'reread' : 'fail';
}
