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

/** 原價格的顯示門檻（容器查詢）：依字數估 13px 字寬＋6px 左距，留約 8px 餘裕。class 字串要寫死 Tailwind 才掃得到 */
const origShowAt = (text: string) =>
  text.length <= 6 ? '@min-[3.5rem]:inline' : text.length === 7 ? '@min-[3.75rem]:inline' : '@min-[4.25rem]:inline';

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
        {/* 價格列（R5）：價格與「已售 N」同列，原價接在價格後。優先序 價格 > 已售 > 原價：
            原價放在自己的容器格（basis-0 flex-1，吃剩下的空間），剩餘寬度放得下它（門檻依字數：見 origShowAt）才顯示；間距用 margin 不用 gap，空格子才不佔位，
            所以永遠不會裁到一半；只有價格＋已售本身放不下時（200% 縮放）已售才換到下一行。任何情況不重疊 */}
        <div className="mt-2 flex flex-wrap items-baseline">
          <span className={`shrink-0 whitespace-nowrap text-headline font-bold ${soldOut ? 'text-muted' : 'text-ink'}`}>{money(price)}</span>
          {originalPrice && (
            <span className="@container min-w-0 flex-1 basis-0">
              <s className={`ml-1.5 hidden whitespace-nowrap text-footnote text-muted ${origShowAt(money(originalPrice))}`}>{money(originalPrice)}</s>
            </span>
          )}
          {product.sold > 0 && (
            <span className="ml-auto shrink-0 whitespace-nowrap pl-1.5 text-footnote text-muted">已售 {soldText(product.sold)}</span>
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
