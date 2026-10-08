import { CheckCircle2, Package, PackageCheck, Truck, XCircle } from 'lucide-react';
import type { Order, OrderEvent } from '../types';

const STEP: Record<OrderEvent['status'], { label: string; hint: string; icon: typeof Package; tone: string }> = {
  placed: { label: '訂單成立', hint: '等待賣家確認並出貨', icon: Package, tone: 'text-brand' },
  to_ship: { label: '待出貨', hint: '賣家準備中', icon: Package, tone: 'text-brand' },
  shipping: { label: '賣家已出貨', hint: '包裹運送中', icon: Truck, tone: 'text-info-text' },
  completed: { label: '訂單完成', hint: '買家已確認收貨', icon: PackageCheck, tone: 'text-success-text' },
  cancelled: { label: '訂單取消', hint: '', icon: XCircle, tone: 'text-muted' },
};

const when = (iso: string) =>
  new Date(iso).toLocaleString('zh-TW', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });

/** 訂單歷程：買家與賣家看到的是同一份資料（資料庫在狀態變動時自動記錄） */
export default function OrderTimeline({ order }: { order: Order }) {
  const events = [...(order.events ?? [])].reverse(); // 最新的在最上面
  if (events.length === 0) return null;

  return (
    <div className="rounded-md bg-canvas p-4">
      {(order.carrier || order.trackingNo) && (
        <p className="mb-3 flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-line pb-3 text-sm">
          <span className="text-muted">物流</span>
          <span>{order.carrier ?? '—'}</span>
          {order.trackingNo && (
            <span className="rounded-sm bg-success-soft px-1.5 py-0.5 font-mono text-xs text-success-text">
              # {order.trackingNo}
            </span>
          )}
        </p>
      )}

      <ol className="space-y-0">
        {events.map((e, i) => {
          const step = STEP[e.status] ?? STEP.placed;
          const Icon = step.icon;
          const latest = i === 0;
          return (
            <li key={`${e.status}-${e.at}`} className="flex gap-3">
              {/* 圓點與連接線 */}
              <div className="flex flex-col items-center">
                <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${latest ? 'bg-white shadow-sm' : ''} ${latest ? step.tone : 'text-disabled'}`}>
                  {latest ? <Icon size={16} /> : <CheckCircle2 size={12} />}
                </span>
                {i < events.length - 1 && <span className="w-px flex-1 bg-line" />}
              </div>
              <div className={`pb-4 ${latest ? '' : 'opacity-60'}`}>
                <p className={`text-sm ${latest ? `font-medium ${step.tone}` : ''}`}>{step.label}</p>
                {latest && step.hint && <p className="text-xs text-muted">{step.hint}</p>}
                <p className="mt-0.5 text-xs text-muted">{when(e.at)}</p>
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
