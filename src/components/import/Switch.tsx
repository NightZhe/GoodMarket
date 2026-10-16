import { useId } from 'react';
import { focusRing } from './ui';

interface Props {
  title: string;
  description: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (next: boolean) => void;
}

/** 整列都可點；role="switch" 以 Space／Enter 切換。關態軌道用 muted，維持對白底 ≥ 3:1 */
export default function Switch({ title, description, checked, disabled = false, onChange }: Props) {
  const id = useId();
  return (
    <button
      type="button" role="switch" aria-checked={checked} disabled={disabled}
      aria-labelledby={`${id}-t`} aria-describedby={`${id}-d`}
      onClick={() => onChange(!checked)}
      className={`flex w-full items-start gap-3 rounded-md border border-line bg-white p-3 text-left disabled:opacity-60 ${focusRing}`}
    >
      <span
        aria-hidden="true"
        className={`mt-0.5 flex h-6 w-11 shrink-0 items-center rounded-full p-0.5 motion-safe:transition-colors ${checked ? 'bg-brand' : 'bg-muted'}`}
      >
        <span className={`h-5 w-5 rounded-full bg-white motion-safe:transition-transform ${checked ? 'translate-x-5' : 'translate-x-0'}`} />
      </span>
      <span className="min-w-0">
        <span id={`${id}-t`} className="block text-sm font-medium">{title}</span>
        <span id={`${id}-d`} className="mt-0.5 block text-xs text-muted">{description}</span>
      </span>
    </button>
  );
}
