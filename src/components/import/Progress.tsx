export type ProgressKind = 'running' | 'done' | 'interrupted' | 'preparing';

const BAR: Record<ProgressKind, string> = {
  running: 'bg-brand',
  done: 'bg-success',
  interrupted: 'bg-warning-text',
  preparing: 'bg-line',
};

interface Props {
  kind: ProgressKind;
  label: string;
  /** 例：「412／1,059 張」；永遠同時顯示數字，進度條只是輔助 */
  valueText: string;
  percent: number;
  note?: string;
}

/** 8px 進度條；寬度變化在「減少動態效果」下不做轉場（數字照常更新） */
export default function Progress({ kind, label, valueText, percent, note }: Props) {
  const pct = Math.max(0, Math.min(100, Math.round(percent)));
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span className="font-medium">{label}</span>
        <span className="tabular-nums">
          {valueText}
          {kind === 'interrupted' && <span className="ml-1 text-warning-text">（已中斷）</span>}
        </span>
      </div>
      <div
        role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}
        aria-valuetext={valueText} className="mt-2 h-2 overflow-hidden rounded-full bg-line"
      >
        <div className={`h-full rounded-full motion-safe:transition-[width] ${BAR[kind]}`} style={{ width: `${pct}%` }} />
      </div>
      {note && <p className="mt-1.5 text-xs text-muted">{note}</p>}
    </div>
  );
}
