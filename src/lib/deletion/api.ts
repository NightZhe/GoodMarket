import { AccountError, rpc } from '../account/api';

// 刪除帳號申請的三個 RPC（介面見 .work/store-prereqs/interface-store-prereqs.md §1）。
// 錯誤一律是 AccountError：呼叫端只看 kind 與 code。兩張表對前端零權限，不得直接 .from()。

export interface DeletionRequest {
  id: string;
  status: 'pending';
  /** 帶時區的時間字串（UTC） */
  requested_at: string;
  /** 台北日期 'YYYY-MM-DD'，伺服器算好，前端不自己算 */
  due_date: string;
}

export interface DeletionStatus {
  request: DeletionRequest | null;
  has_shop: boolean;
  unfinished_buyer_orders: number;
  unfinished_shop_orders: number;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isCount = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0;

export function parseRequest(raw: unknown): DeletionRequest | null {
  if (!isObj(raw)) return null;
  const { id, status, requested_at, due_date } = raw;
  if (typeof id !== 'string' || status !== 'pending' || typeof requested_at !== 'string' || typeof due_date !== 'string') return null;
  return { id, status, requested_at, due_date };
}

/** 形狀不對（不該發生）就丟 server 錯誤，畫面走「讀不到」；不把壞資料當成「可申請」 */
export function parseStatus(raw: unknown): DeletionStatus {
  if (isObj(raw)) {
    const { request, has_shop, unfinished_buyer_orders, unfinished_shop_orders } = raw;
    const parsed = request === null ? null : parseRequest(request);
    if ((request === null || parsed !== null) && typeof has_shop === 'boolean' && isCount(unfinished_buyer_orders) && isCount(unfinished_shop_orders)) {
      return { request: parsed, has_shop, unfinished_buyer_orders, unfinished_shop_orders };
    }
  }
  throw new AccountError('刪除申請的狀態格式不正確', 'server', null);
}

export async function getDeletionStatus(): Promise<DeletionStatus> {
  return parseStatus(await rpc<unknown>('get_account_deletion_status'));
}

/** 回傳新建的那筆申請本身（不是外包一層） */
export async function requestDeletion(): Promise<DeletionRequest> {
  const req = parseRequest(await rpc<unknown>('request_account_deletion'));
  if (!req) throw new AccountError('刪除申請的回應格式不正確', 'server', null);
  return req;
}

export async function cancelDeletion(): Promise<void> {
  await rpc<unknown>('cancel_account_deletion');
}
