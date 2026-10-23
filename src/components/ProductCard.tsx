import { Link } from 'react-router-dom';
import { Star } from 'lucide-react';
import type { Product } from '../types';
import Photo from './Photo';
import { money, soldText } from '../lib/format';
import { ratingText } from '../lib/reviews/format';
import { useReviews } from '../store/ReviewsContext';
import { useProductView } from './useProductView';

type Variant = 'grid' | 'shelf';

const widthOf: Record<Variant, string> = {
  grid: 'w-auto',
  shelf: 'w-[150px] shrink-0 snap-start',
};

/** 按下照片 opacity .7（0ms 進、150ms 出）；hover 只給滑鼠，不浮起 */
const photoPress =
  '[&>:first-child]:transition-opacity [&>:first-child]:duration-150 [&>:first-child]:ease-out ' +
  'group-active:[&>:first-child]:opacity-70 group-active:[&>:first-child]:duration-0 ' +
  '[@media(hover:hover)_and_(pointer:fine)]:group-hover:[&>:first-child]:opacity-85';

export default function ProductCard({ product, variant = 'grid' }: { product: Product; variant?: Variant }) {
  const { price, originalPrice, soldOut, label, shopLine } = useProductView(product);
  // 評分來自真實評價；沒有評價（或還沒載入）就不顯示星星，不會閃一個假的分數
  const stat = useReviews().productStat(product.id);

  return (
    <Link to={`/product/${product.id}`} aria-label={label} className={`group block min-w-0 ${widthOf[variant]}`}>
      {/* 照片 alt=""、內文 aria-hidden：整張卡只由 Link 的 aria-label 唸一次 */}
      <div aria-hidden="true">
        <Photo src={product.images[0]} alt="" className={`aspect-square ${photoPress}`}>
          {soldOut && (
            <div className="absolute inset-0 grid place-items-center bg-white/60">
              <span className="rounded-xl bg-black/72 px-2.5 py-1 text-footnote font-semibold text-white">已售完</span>
            </div>
          )}
        </Photo>
        {/* 價格列不折行（R5：已售留在右側）。價格與已售不動；擠不下時原價整個換到第二行再被裁掉（只留半截「$」比不顯示更糟） */}
        <div className="mt-2 flex items-baseline justify-between gap-x-1.5 overflow-hidden">
          <span className="flex h-[1lh] min-w-0 flex-wrap items-baseline gap-x-1.5 overflow-y-clip text-headline">
            <span className={`shrink-0 whitespace-nowrap font-bold ${soldOut ? 'text-muted' : 'text-ink'}`}>{money(price)}</span>
            {originalPrice && <s className="min-w-0 truncate text-footnote text-muted">{money(originalPrice)}</s>}
          </span>
          {product.sold > 0 && (
            <span className="shrink-0 whitespace-nowrap text-footnote text-muted">已售 {soldText(product.sold)}</span>
          )}
        </div>
        <p className="mt-0.5 line-clamp-2 text-subhead text-ink">{product.title}</p>
        <div className="flex items-center gap-1.5 text-footnote text-muted">
          {stat && (
            <span className="flex shrink-0 items-center gap-0.5">
              <Star size={12} className="fill-current" aria-hidden="true" />
              {ratingText(stat.avg)}
            </span>
          )}
          <span className="min-w-0 truncate">{shopLine}</span>
        </div>
      </div>
    </Link>
  );
}

/** 載入中的靜態灰塊（不做 shimmer）：照片位＋2 條灰條，尺寸同實際卡片 */
export function ProductCardSkeleton({ variant = 'grid' }: { variant?: Variant }) {
  return (
    <div aria-hidden="true" className={`min-w-0 ${widthOf[variant]}`}>
      <div className="aspect-square rounded-card bg-canvas" />
      <div className="mt-3 h-4 w-4/5 rounded-md bg-canvas" />
      <div className="mt-2 h-3.5 w-1/2 rounded-md bg-canvas" />
    </div>
  );
}
