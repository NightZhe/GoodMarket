import { focusRing } from './ui';

export type KpiKind = 'new' | 'update' | 'error' | 'warn' | 'skip';

const COLOR: Record<KpiKind, string> = {
  new: 'text-success-text',
  update: 'text-info-text',
  error: 'text-error-text',
  warn: 'text-warning-text',
  skip: 'text-muted',
};

interface Props {
  kind: KpiKind;
  label: string;
  sub?: string;
  value: number | null;
  selected?: boolean;
  /** 沒有 onClick 時只是靜態數字（結果頁） */
  onClick?: () => void;
}

/** 數字為 0 時改用 muted，不再用語意色；有 onClick 時同時是篩選器（aria-pressed） */
export default function KPI({ kind, label, sub, value, selected = false, onClick }: Props) {
  const color = value === null || value === 0 ? 'text-muted' : COLOR[kind];
  const content = (
    <>
      <span className="block text-xs text-muted">{label}</span>
      <span className={`mt-0.5 block text-2xl font-bold tabular-nums ${color}`}>
        {value === null ? '—' : value.toLocaleString('en-US')}
      </span>
      {sub && <span className="block text-xs text-muted">{sub}</span>}
    </>
  );
  const box = 'min-h-11 rounded-md border bg-white p-3 text-left';
  if (!onClick) return <div className={`${box} border-line`}>{content}</div>;
  return (
    <button
      type="button" aria-pressed={selected} onClick={onClick}
      className={`${box} ${focusRing} ${selected ? 'border-2 border-brand bg-brand-soft' : 'border-line hover:bg-subtle'}`}
    >
      {content}
    </button>
  );
}
