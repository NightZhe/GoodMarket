import { Minus, Plus } from 'lucide-react';

interface Props {
  value: number;
  max: number;
  onChange: (n: number) => void;
}

export default function QtyStepper({ value, max, onChange }: Props) {
  const btn = 'flex h-8 w-8 items-center justify-center text-ink transition hover:bg-canvas disabled:text-gray-300';
  return (
    <div className="inline-flex items-center rounded-sm border border-line">
      <button type="button" aria-label="減少" className={btn} disabled={value <= 1} onClick={() => onChange(value - 1)}>
        <Minus size={14} />
      </button>
      <input
        aria-label="數量"
        inputMode="numeric"
        value={value}
        onChange={e => {
          const n = parseInt(e.target.value.replace(/\D/g, ''), 10);
          onChange(Number.isNaN(n) ? 1 : Math.min(Math.max(1, n), Math.max(1, max)));
        }}
        className="h-8 w-12 border-x border-line text-center text-sm outline-none"
      />
      <button type="button" aria-label="增加" className={btn} disabled={value >= max} onClick={() => onChange(value + 1)}>
        <Plus size={14} />
      </button>
    </div>
  );
}
