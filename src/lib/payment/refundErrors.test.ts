import { describe, expect, it } from 'vitest';
import { AccountError } from '../account/errors';
import { buyerCancelFailure, sellerCancelFailure } from './refundErrors';

const server = (code: string, message = '伺服器的中文訊息') => new AccountError(message, 'server', code);

// 句子取自 design-refund.md §4.5（買家）與 §5.5（賣家）

describe('買家取消申請失敗時怎麼顯示（設計 4.5）', () => {
  it('狀態已變：用設計的句子，不用伺服器那句，並重讀', () => {
    expect(buyerCancelFailure(server('ORDER_STATE_CHANGED'))).toMatchObject({ kind: 'toast', text: '這筆訂單已經出貨或已取消，無法申請取消。畫面已更新。', reload: true, keepOpen: false });
  });
  it('已申請過、不能再申請、申請已有結果：都重讀', () => {
    expect(buyerCancelFailure(server('CANCEL_ALREADY_REQUESTED'))).toMatchObject({ text: '這筆訂單已經申請過取消。畫面已更新。', reload: true });
    expect(buyerCancelFailure(server('CANCEL_REQUEST_NOT_ALLOWED'))).toMatchObject({ text: '每張訂單只能申請一次取消，這筆訂單不能再申請。', reload: true });
    expect(buyerCancelFailure(server('CANCEL_REQUEST_NOT_FOUND'))).toMatchObject({ text: '這筆申請已經有結果。畫面已更新。', reload: true });
  });
  it('付款處理中沿用現有句，不重讀', () => {
    expect(buyerCancelFailure(server('PAYMENT_IN_PROGRESS'))).toMatchObject({ kind: 'toast', text: '付款正在處理中，暫時無法取消。', reload: false });
  });
  it('不是已付款單、找不到：這筆訂單目前無法申請取消，並重讀', () => {
    expect(buyerCancelFailure(server('ORDER_NOT_PAID'))).toMatchObject({ text: '這筆訂單目前無法申請取消。', reload: true });
    expect(buyerCancelFailure(server('ORDER_NOT_FOUND'))).toMatchObject({ text: '這筆訂單目前無法申請取消。', reload: true });
  });
  it('原因不對：不用 toast，顯示在欄位下方', () => {
    expect(buyerCancelFailure(server('REASON_INVALID', '補充說明最多 100 字'))).toMatchObject({ kind: 'field', text: '補充說明最多 100 字', reload: false });
    expect(buyerCancelFailure(new AccountError('', 'server', 'REASON_INVALID'))).toMatchObject({ kind: 'field', text: '請選擇取消原因。' });
  });
  it('斷線、逾時：對話框保持開著可再按，固定中文句', () => {
    expect(buyerCancelFailure(new AccountError('Failed to fetch', 'network', null))).toMatchObject({ kind: 'toast', text: '連線失敗，請稍後再試', keepOpen: true, reload: false });
  });
  it('登入過期與沒見過的代碼：沿用 accountErrorText（有伺服器中文就用，不出現英文）', () => {
    expect(buyerCancelFailure(new AccountError('JWT expired', 'auth', null)).text).toBe('登入已過期，請重新登入。');
    expect(buyerCancelFailure(server('SOMETHING_NEW', '新的中文訊息')).text).toBe('新的中文訊息');
    expect(buyerCancelFailure(new AccountError('permission denied', 'server', null)).text).toBe('操作失敗，請稍後再試');
  });
});

describe('賣家同意／拒絕／取消並退款失敗時怎麼顯示（設計 5.5）', () => {
  it('狀態已變、申請已被處理：設計的句子並重讀', () => {
    expect(sellerCancelFailure(server('ORDER_STATE_CHANGED'))).toMatchObject({ kind: 'toast', text: '這筆訂單的狀態已經改變（買家可能剛撤回或取消）。畫面已更新。', reload: true });
    expect(sellerCancelFailure(server('CANCEL_REQUEST_NOT_FOUND'))).toMatchObject({ text: '這筆申請已經被處理（買家可能剛撤回）。畫面已更新。', reload: true });
  });
  it('買家申請中卻按到取消並退款（理論上畫面不會讓人按到）：請先同意或拒絕，並重讀', () => {
    expect(sellerCancelFailure(server('CANCEL_REQUEST_PENDING'))).toMatchObject({ text: '買家正在申請取消，請先同意或拒絕。', reload: true });
  });
  it('不是已付款單、找不到：目前無法取消並退款', () => {
    expect(sellerCancelFailure(server('ORDER_NOT_PAID'))).toMatchObject({ text: '這筆訂單目前無法取消並退款。', reload: true });
    expect(sellerCancelFailure(server('ORDER_NOT_FOUND'))).toMatchObject({ text: '這筆訂單目前無法取消並退款。', reload: true });
  });
  it('拒絕沒填原因、原因不對：欄位下方錯誤，不用 toast', () => {
    expect(sellerCancelFailure(server('REJECT_REASON_REQUIRED'))).toMatchObject({ kind: 'field', text: '請填寫拒絕原因。', reload: false });
    expect(sellerCancelFailure(server('REASON_INVALID', '拒絕原因最多 100 字'))).toMatchObject({ kind: 'field', text: '拒絕原因最多 100 字' });
    expect(sellerCancelFailure(new AccountError('', 'server', 'REASON_INVALID'))).toMatchObject({ kind: 'field', text: '請選擇取消原因。' });
  });
  it('斷線：保持開著', () => {
    expect(sellerCancelFailure(new AccountError('Load failed', 'network', null))).toMatchObject({ text: '連線失敗，請稍後再試', keepOpen: true });
  });
  it('資料庫直接擋下的寫入（R-RF5、R-RF10）：顯示伺服器訊息並重讀', () => {
    expect(sellerCancelFailure(server('PAID_ORDER_USE_REFUND', '已付款的訂單請用「取消並退款」'))).toMatchObject({ text: '已付款的訂單請用「取消並退款」', reload: true });
  });
});
