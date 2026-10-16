import { useId, useState } from 'react';
import { Star } from 'lucide-react';
import { STAR_WORDS, avgStarsLabel, starsLabel } from '../../lib/reviews/format';

/** 單則評價的星等（整數 1–5）。星星本身是裝飾，資訊由外層 role="img" 的文字替代讀一次 */
export function StarsDisplay({ value, size = 14 }: { value: number; size?: number }) {
  return (
    <span role="img" aria-label={starsLabel(value)} className="inline-flex gap-0.5">
      {[1, 2, 3, 4, 5].map(n => (
        <Star key={n} size={size} aria-hidden="true" className={n <= value ? 'fill-star text-star' : 'fill-disabled text-disabled'} />
      ))}
    </span>
  );
}

/** 平均分：底層 5 顆灰星、上層 5 顆黃星用寬度裁切，做出局部填色 */
export function StarsAvg({ value, count, size = 18 }: { value: number; count: number; size?: number }) {
  const pct = Math.max(0, Math.min(100, (value / 5) * 100));
  const row = (cls: string) => (
    <span className="flex gap-0.5">
      {[1, 2, 3, 4, 5].map(n => <Star key={n} size={size} aria-hidden="true" className={`shrink-0 ${cls}`} />)}
    </span>
  );
  return (
    <span role="img" aria-label={avgStarsLabel(value, count)} className="relative inline-block">
      {row('fill-disabled text-disabled')}
      <span className="absolute inset-y-0 left-0 overflow-hidden" style={{ width: `${pct}%` }}>
        {row('fill-star text-star')}
      </span>
    </span>
  );
}

interface InputProps {
  /** legend 之後給讀屏的商品名，多件商品才分得出來 */
  productName: string;
  value: number;
  onChange: (n: number) => void;
}

/**
 * 星等輸入：原生 radio 群組（讀屏、方向鍵、單一 Tab 停駐點都是瀏覽器內建的）。
 * 沒有任何縮放或彈跳，填色瞬間切換，所以「減少動態效果」不需要另外處理。
 */
export function StarInput({ productName, value, onChange }: InputProps) {
  const name = useId();
  const [hover, setHover] = useState(0);
  const shown = hover || value;
  return (
    <fieldset>
      <legend className="text-sm font-medium">
        商品評分<span className="sr-only">（{productName}）</span>
      </legend>
      <div className="mt-1 flex flex-wrap items-center gap-x-3">
        <div className="flex flex-wrap" onMouseLeave={() => setHover(0)}>
          {[1, 2, 3, 4, 5].map(n => (
            <label
              key={n}
              onMouseEnter={() => setHover(n)}
              className="flex h-11 w-11 cursor-pointer items-center justify-center has-[:focus-visible]:outline-2 has-[:focus-visible]:-outline-offset-2 has-[:focus-visible]:outline-brand"
            >
              <input
                type="radio" name={name} value={n} checked={value === n} onChange={() => onChange(n)}
                className="sr-only"
              />
              <span className="sr-only">{n} 顆星</span>
              <Star
                size={32} strokeWidth={1.5} aria-hidden="true"
                className={n <= shown ? 'fill-star text-star' : 'text-muted'}
              />
            </label>
          ))}
        </div>
        <span className={`text-sm ${value > 0 ? 'text-ink' : 'text-muted'}`} aria-hidden="true">
          {value > 0 ? STAR_WORDS[value] : '點星星評分'}
        </span>
        {value > 0 && (
          <button
            type="button" onClick={() => { setHover(0); onChange(0); }}
            className="min-h-11 px-2 text-sm text-muted underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
          >
            清除<span className="sr-only">評分（{productName}）</span>
          </button>
        )}
      </div>
      {value === 0 && <p className="text-xs text-muted">沒有評分的商品不會送出</p>}
    </fieldset>
  );
}
