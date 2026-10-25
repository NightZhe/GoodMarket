import { money } from '../lib/format';

interface Props {
  price: number;
  /** 已售完：字色轉 muted */
  muted?: boolean;
  className?: string;
}

/** 列表列右側的灰膠囊價格。不是按鈕，整列才是連結 */
export default function PricePill({ price, muted = false, className = '' }: Props) {
  return (
    <span
      className={`inline-flex h-7.5 min-w-18 shrink-0 items-center justify-center whitespace-nowrap rounded-full bg-canvas px-3 text-subhead font-semibold ${muted ? 'text-muted' : 'text-brand'} ${className}`}
    >
      {money(price)}
    </span>
  );
}
