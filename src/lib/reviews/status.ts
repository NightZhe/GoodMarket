import type { MyReviewItem, OrderReviewStatus } from './types';

/** S-1 訂單卡片的評價列（待出貨等其他狀態的訂單不會走到這裡） */
export type CardState =
  | { kind: 'reviewable'; deadlineDate: string; unreviewed: number; total: number }
  | { kind: 'allDone'; total: number }
  | { kind: 'expired'; reviewed: number; unreviewed: number };

export function orderCardState(s: OrderReviewStatus): CardState | null {
  const total = s.items.length;
  if (total === 0) return null;
  const reviewed = s.items.filter(i => i.reviewed).length;
  const unreviewed = total - reviewed;
  if (unreviewed === 0) return { kind: 'allDone', total };
  if (s.expired) return { kind: 'expired', reviewed, unreviewed };
  return { kind: 'reviewable', deadlineDate: s.deadline_date, unreviewed, total };
}

/** 表單：可填的在前，已評價的在後（S-2） */
export function partitionItems(items: MyReviewItem[]): { open: MyReviewItem[]; done: MyReviewItem[] } {
  return { open: items.filter(i => !i.reviewed), done: items.filter(i => i.reviewed) };
}

export type FormGate =
  | { kind: 'form' }            // 可以填
  | { kind: 'readonly' }        // 只能看已送出的內容（已過期但有評過、或全部評過）
  | { kind: 'expiredEmpty' }    // 已過期，一件都沒評過
  | { kind: 'empty' };          // 沒有商品可顯示

export function formGate(s: OrderReviewStatus): FormGate {
  const { open, done } = partitionItems(s.items);
  if (s.items.length === 0) return { kind: 'empty' };
  if (open.length === 0) return { kind: 'readonly' };
  if (s.expired) return done.length === 0 ? { kind: 'expiredEmpty' } : { kind: 'readonly' };
  return { kind: 'form' };
}
