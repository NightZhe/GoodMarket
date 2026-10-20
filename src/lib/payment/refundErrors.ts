import { accountErrorText, toAccountError } from '../account/errors';
import { NETWORK_ERROR_MESSAGE } from '../orders/errors';

// 取消申請／同意／拒絕／取消並退款失敗時畫面怎麼說（設計 4.5、5.5）。錯誤碼是 RPC 的 error.hint。
// 對話框裡的欄位錯誤（kind='field'）顯示在欄位下方；其餘用 toast。reload＝狀態可能已經變了，要重讀三份資料。

export interface CancelFailure {
  kind: 'toast' | 'field';
  text: string;
  /** 畫面資料可能過期：重讀申請／退款、付款資訊與訂單列表 */
  reload: boolean;
  /** 沒有回應（斷線、逾時）：對話框保持開著，可以再按 */
  keepOpen: boolean;
}

const toast = (text: string, reload: boolean): CancelFailure => ({ kind: 'toast', text, reload, keepOpen: false });

export function buyerCancelFailure(e: unknown): CancelFailure {
  const err = toAccountError(e);
  if (err.kind === 'network') return { kind: 'toast', text: NETWORK_ERROR_MESSAGE, reload: false, keepOpen: true };
  switch (err.code) {
    case 'ORDER_STATE_CHANGED': return toast('這筆訂單已經出貨或已取消，無法申請取消。畫面已更新。', true);
    case 'CANCEL_ALREADY_REQUESTED': return toast('這筆訂單已經申請過取消。畫面已更新。', true);
    case 'CANCEL_REQUEST_NOT_ALLOWED': return toast('每張訂單只能申請一次取消，這筆訂單不能再申請。', true);
    case 'CANCEL_REQUEST_NOT_FOUND': return toast('這筆申請已經有結果。畫面已更新。', true);
    case 'PAYMENT_IN_PROGRESS': return toast('付款正在處理中，暫時無法取消。', false);
    case 'ORDER_NOT_PAID':
    case 'ORDER_NOT_FOUND': return toast('這筆訂單目前無法申請取消。', true);
    case 'REASON_INVALID': return { kind: 'field', text: err.message || '請選擇取消原因。', reload: false, keepOpen: false };
    default: return toast(accountErrorText(err, '操作失敗，請稍後再試'), false);
  }
}

export function sellerCancelFailure(e: unknown): CancelFailure {
  const err = toAccountError(e);
  if (err.kind === 'network') return { kind: 'toast', text: NETWORK_ERROR_MESSAGE, reload: false, keepOpen: true };
  switch (err.code) {
    case 'ORDER_STATE_CHANGED': return toast('這筆訂單的狀態已經改變（買家可能剛撤回或取消）。畫面已更新。', true);
    case 'CANCEL_REQUEST_NOT_FOUND': return toast('這筆申請已經被處理（買家可能剛撤回）。畫面已更新。', true);
    case 'CANCEL_REQUEST_PENDING': return toast('買家正在申請取消，請先同意或拒絕。', true);
    case 'ORDER_NOT_PAID':
    case 'ORDER_NOT_FOUND': return toast('這筆訂單目前無法取消並退款。', true);
    case 'REJECT_REASON_REQUIRED': return { kind: 'field', text: '請填寫拒絕原因。', reload: false, keepOpen: false };
    case 'REASON_INVALID': return { kind: 'field', text: err.message || '請選擇取消原因。', reload: false, keepOpen: false };
    // 資料庫直接擋下的寫入（已付款單改成已取消、申請中改成出貨）：訊息已是中文，畫面可能過期所以重讀
    case 'PAID_ORDER_USE_REFUND': return toast(accountErrorText(err, '已付款的訂單請用「取消並退款」'), true);
    default: return toast(accountErrorText(err, '操作失敗，請稍後再試'), false);
  }
}
