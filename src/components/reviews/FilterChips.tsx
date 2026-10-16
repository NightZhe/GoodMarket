import { Check } from 'lucide-react';
import { NO_FILTER, isFiltering, togglePhotos, toggleRating, type BuyerFilter } from '../../lib/reviews/filters';
import { focusRing } from '../import/ui';

type Counts = Record<'1' | '2' | '3' | '4' | '5', number>;

const num = (n: number | undefined) => (n === undefined ? '–' : String(n));

/** 買家端篩選（S-4）：選中＝外框＋底色＋粗體＋勾，不只靠顏色 */
export function FilterChips({ filter, total, withPhotos, counts, onChange }: {
  filter: BuyerFilter;
  total?: number;
  withPhotos?: number;
  counts?: Counts;
  onChange: (f: BuyerFilter) => void;
}) {
  const chip = (label: string, count: number | undefined, on: boolean, click: () => void) => (
    <button
      key={label} type="button" aria-pressed={on} onClick={click}
      className={`inline-flex min-h-11 items-center gap-1 rounded-sm border px-3 text-sm ${on ? 'border-brand bg-brand-soft font-medium' : 'border-line bg-white'} ${focusRing}`}
    >
      {on && <Check size={14} aria-hidden="true" />}
      {label} ({num(count)})
    </button>
  );
  return (
    <div role="group" aria-label="篩選評價" className="flex flex-wrap gap-2 p-3 md:p-4">
      {chip('全部', total, !isFiltering(filter), () => onChange(NO_FILTER))}
      {chip('附照片', withPhotos, filter.photos, () => onChange(togglePhotos(filter)))}
      {([5, 4, 3, 2, 1] as const).map(n =>
        chip(`${n} 星`, counts?.[String(n) as keyof Counts], filter.rating === n, () => onChange(toggleRating(filter, n))))}
    </div>
  );
}

/** 賣家端：6 個互斥選項，用原生 radio（讀屏會唸「已選取」，AC-79） */
export function RatingRadioChips({ value, counts, onChange }: {
  value: number | null;
  counts: Record<'all' | '1' | '2' | '3' | '4' | '5', number> | undefined;
  onChange: (rating: number | null) => void;
}) {
  const options: { key: 'all' | '1' | '2' | '3' | '4' | '5'; label: string; rating: number | null }[] = [
    { key: 'all', label: '全部', rating: null },
    ...([5, 4, 3, 2, 1] as const).map(n => ({ key: String(n) as '1', label: `${n} 星`, rating: n })),
  ];
  return (
    <fieldset>
      <legend className="sr-only">依星等篩選</legend>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(6rem,1fr))] gap-2 md:flex md:flex-wrap">
        {options.map(o => {
          const on = value === o.rating;
          return (
            <label
              key={o.key}
              className={`group relative flex min-h-11 cursor-pointer items-center justify-center gap-1 rounded-sm border px-2 text-sm has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-brand ${on ? 'border-brand bg-brand-soft font-medium' : 'border-line bg-white'}`}
            >
              <input
                type="radio" name="seller-rating-filter" checked={on} onChange={() => onChange(o.rating)}
                className="sr-only"
              />
              {on && <Check size={14} aria-hidden="true" />}
              {o.label} ({num(counts?.[o.key])})
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
