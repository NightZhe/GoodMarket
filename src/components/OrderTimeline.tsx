import { Building2, CheckCircle2, Hash, Package, PackageCheck, Store, Truck, XCircle } from 'lucide-react';
import ProductImage from './ProductImage';
import type { Order, OrderEvent } from '../types';

const STEP: Record<OrderEvent['status'], { label: string; hint: string; icon: typeof Package; tone: string }> = {
  placed:           { label: '賣家將於確認訂單後出貨', hint: '', icon: Package, tone: 'text-brand' },
  to_ship:          { label: '待出貨', hint: '賣家準備中', icon: Package, tone: 'text-brand' },
  shipping:         { label: '賣家已安排出貨', hint: '', icon: Truck, tone: 'text-info-text' },
  handed_over:      { label: '賣家已寄件成功', hint: '', icon: Store, tone: 'text-info-text' },
  in_transit:       { label: '包裹送往物流中心', hint: '', icon: Building2, tone: 'text-info-text' },
  out_for_delivery: { label: '包裹配送中', hint: '', icon: Truck, tone: 'text-success-text' },
  arrived_store:    { label: '已送達門市，待取貨', hint: '記得帶手機取貨', icon: Store, tone: 'text-success-text' },
  picked_up:        { label: '買家已取貨', hint: '', icon: PackageCheck, tone: 'text-success-text' },
  completed:        { label: '訂單完成', hint: '買家已確認收貨', icon: PackageCheck, tone: 'text-success-text' },
  cancelled:        { label: '訂單取消', hint: '', icon: XCircle, tone: 'text-muted' },
};

const when = (iso: string) =>
  new Date(iso).toLocaleString('zh-TW', { hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });

/** 訂單歷程：買家與賣家看到的是同一份資料（資料庫在狀態變動時自動記錄） */
export default function OrderTimeline({ order }: { order: Order }) {
  const events = [...(order.events ?? [])].reverse(); // 最新的在最上面
  if (events.length === 0) return null;

  return (
    <div className="rounded-md bg-canvas p-4">
      {/* 運送資訊：包裹、物流方式、單號、包了哪些商品 */}
      <div className="mb-3 border-b border-line pb-3">
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
          <span className="font-medium">包裹 1：</span>
          <span>{order.carrier ?? '尚未安排物流'}</span>
          {order.trackingNo && (
            <span className="flex items-center gap-0.5 rounded-sm bg-success px-1.5 py-0.5 font-mono text-xs text-white">
              <Hash size={11} />{order.trackingNo}
            </span>
          )}
        </p>
        <div className="mt-2 flex items-center gap-2">
          <div className="flex -space-x-2">
            {order.lines.slice(0, 3).map(l => (
              <ProductImage key={l.variantId} src={l.image} alt="" size="sm"
                className="w-10 rounded-sm border-2 border-white bg-white" />
            ))}
          </div>
          <span className="text-xs text-muted">
            共 {order.lines.reduce((n, l) => n + l.qty, 0)} 個商品
          </span>
        </div>
      </div>

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
