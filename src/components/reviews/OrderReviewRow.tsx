import { Link } from 'react-router-dom';
import { CircleCheck } from 'lucide-react';
import { orderCardState } from '../../lib/reviews/status';
import { deadlineLabel } from '../../lib/reviews/format';
import type { OrderReviewStatus } from '../../lib/reviews/types';
import { btnOutline, btnPrimary } from '../import/ui';

const ROW = 'flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-t border-line bg-subtle px-4 py-3';

/** 載入中的骨架：高度與「評價」那一列一致，避免畫面跳動 */
export function OrderReviewRowSkeleton() {
  return (
    <div className={ROW} aria-hidden="true">
      <div className="space-y-2">
        <div className="h-4 w-40 rounded-sm bg-line motion-safe:animate-pulse" />
        <div className="h-3 w-24 rounded-sm bg-line motion-safe:animate-pulse" />
      </div>
      <div className="h-11 w-24 rounded-sm bg-line motion-safe:animate-pulse" />
    </div>
  );
}

/** S-1：已完成訂單卡片上的評價列（a 可評價／b 全部評過／c 已過期） */
export default function OrderReviewRow({ status }: { status: OrderReviewStatus }) {
  const state = orderCardState(status);
  if (!state) return null;
  const to = `/orders/${status.order_id}/review`;

  if (state.kind === 'reviewable') {
    return (
      <div className={ROW}>
        <div className="min-w-0 text-sm">
          <p>{deadlineLabel(state.deadlineDate)}</p>
          {state.total > 1 && <p className="text-xs text-muted">{state.unreviewed} 件商品還沒評價</p>}
        </div>
        <Link to={to} className={`${btnPrimary} min-w-24 px-5`}>評價</Link>
      </div>
    );
  }
  if (state.kind === 'allDone') {
    return (
      <div className={ROW}>
        <p className="flex min-w-0 items-center gap-1.5 text-sm">
          <CircleCheck size={16} className="text-success" aria-hidden="true" />已評價
        </p>
        <Link to={to} className={`${btnOutline} min-w-24 px-5`}>查看評價</Link>
      </div>
    );
  }
  return (
    <div className={ROW}>
      <div className="min-w-0 text-sm text-muted">
        <p>評價期限已過</p>
        {state.reviewed > 0 && <p className="text-xs">已評價 {state.reviewed} 件，另有 {state.unreviewed} 件未評價</p>}
      </div>
      {state.reviewed > 0 && <Link to={to} className={`${btnOutline} min-w-24 px-5`}>查看評價</Link>}
    </div>
  );
}
