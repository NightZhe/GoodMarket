import { useId, useRef, type ReactNode } from 'react';
import SheetShell from '../SheetShell';

export interface SheetAction {
  key: string;
  label: string;
  /** 小字說明 */
  hint?: string;
  tone?: 'brand' | 'danger';
  onSelect: () => void;
}

interface Props {
  title: string;
  subtitle?: ReactNode;
  actions: SheetAction[];
  cancelLabel?: string;
  onClose: () => void;
}

const ROW = 'flex min-h-12 w-full flex-col justify-center px-5 py-2 text-left transition-colors duration-200 active:bg-press active:duration-0';

/** 底部動作表（手機抽屜、桌機置中對話框）：聊聊的「對話選項」與列表長按共用。外殼是 SheetShell */
export default function ActionSheet({ title, subtitle, actions, cancelLabel = '取消', onClose }: Props) {
  const titleId = useId();
  const titleRef = useRef<HTMLHeadingElement>(null);
  return (
    <SheetShell titleId={titleId} titleRef={titleRef} onClose={onClose}>
      <div className="px-5 pb-2 pt-5">
        <h2 id={titleId} ref={titleRef} tabIndex={-1} className="text-headline font-semibold text-ink outline-none">{title}</h2>
        {subtitle && <p className="mt-1 text-footnote text-muted">{subtitle}</p>}
      </div>
      <ul className="border-t-[0.5px] border-separator">
        {actions.map(a => (
          <li key={a.key} className="border-b-[0.5px] border-separator">
            <button type="button" onClick={a.onSelect} className={ROW}>
              <span className={`text-body ${a.tone === 'danger' ? 'text-error-text' : 'text-brand'}`}>{a.label}</span>
              {a.hint && <span className="text-footnote text-muted">{a.hint}</span>}
            </button>
          </li>
        ))}
        <li>
          <button type="button" onClick={onClose} className={`${ROW} text-body font-semibold text-ink`}>{cancelLabel}</button>
        </li>
      </ul>
    </SheetShell>
  );
}
