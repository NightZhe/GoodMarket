import { Check } from 'lucide-react';

export const STEP_NAMES = ['放入檔案', '確認預覽', '匯入', '完成'] as const;

/** 步驟列不是導覽：不可點、不在 Tab 順序。桌機四格橫排；手機「步驟 N／4」＋四段進度條 */
export default function Steps({ current }: { current: 1 | 2 | 3 | 4 }) {
  return (
    <div>
      <p aria-hidden="true" className="text-sm md:hidden">
        <span className="font-medium">步驟 {current}／4</span>
        <span className="ml-2 text-muted">{STEP_NAMES[current - 1]}</span>
      </p>
      <div aria-hidden="true" className="mt-2 flex gap-1 md:hidden">
        {STEP_NAMES.map((n, i) => (
          <span key={n} className={`h-1 flex-1 rounded-full ${i + 1 <= current ? 'bg-brand' : 'bg-line'}`} />
        ))}
      </div>
      <ol className="sr-only md:not-sr-only md:flex md:items-center">
        {STEP_NAMES.map((name, i) => {
          const n = i + 1;
          const done = n < current;
          const now = n === current;
          return (
            <li key={name} aria-current={now ? 'step' : undefined} className="flex items-center md:flex-1 md:last:flex-none">
              <span
                aria-hidden="true"
                className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-medium ${
                  done ? 'bg-success text-white' : now ? 'border-2 border-brand bg-white text-brand' : 'bg-line text-muted'}`}
              >
                {done ? <Check size={14} /> : n}
              </span>
              <span className={`ml-2 text-sm ${now ? 'font-bold' : done ? '' : 'text-muted'}`}>
                {name}
                <span className="sr-only">{done ? '（已完成）' : now ? '（目前步驟）' : ''}</span>
              </span>
              {n < 4 && <span aria-hidden="true" className={`mx-3 hidden h-0.5 flex-1 md:block ${done ? 'bg-success' : 'bg-line'}`} />}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
