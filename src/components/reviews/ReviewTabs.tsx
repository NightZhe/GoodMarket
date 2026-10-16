import { useRef } from 'react';

interface Props<T extends string> {
  tabs: readonly { id: T; label: string }[];
  value: T;
  onChange: (id: T) => void;
  label: string;
  /** 買家總覽的分頁籤貼齊頂端 */
  sticky?: boolean;
  className?: string;
}

/**
 * 分頁籤（買家總覽、賣家評價管理共用）。選中樣式跟現有的「訂單」「我的商品」一致：
 * 底線＋ text-brand（decisions.md 主對話裁示，覆蓋 design.md C-9 的 text-ink）；
 * 另有 aria-selected，不只靠顏色。←→ 在分頁之間移動並切換。
 */
export default function ReviewTabs<T extends string>({ tabs, value, onChange, label, sticky, className = '' }: Props<T>) {
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});
  const onKeyDown = (e: React.KeyboardEvent, i: number) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    const next = tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
    onChange(next.id);
    refs.current[next.id]?.focus();
  };
  return (
    <div
      role="tablist" aria-label={label}
      className={`flex border-b border-line bg-white ${sticky ? 'sticky top-[52px] z-20 md:top-[108px] md:rounded-t-md' : 'px-2'} ${className}`}
    >
      {tabs.map((t, i) => {
        const on = t.id === value;
        return (
          <button
            key={t.id} ref={el => { refs.current[t.id] = el; }} type="button" role="tab" aria-selected={on}
            tabIndex={on ? 0 : -1} onClick={() => onChange(t.id)} onKeyDown={e => onKeyDown(e, i)}
            className={`min-h-11 flex-1 border-b-2 px-4 py-3.5 text-sm focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand ${sticky ? '' : 'md:flex-none md:px-8'} ${on ? 'border-brand font-medium text-brand' : 'border-transparent text-muted'}`}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}
