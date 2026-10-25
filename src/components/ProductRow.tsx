import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { Product } from '../types';
import Photo from './Photo';
import PricePill from './PricePill';
import { useProductView } from './useProductView';

/** 列表列：縮圖＋標題＋「店名・地點」＋價格膠囊。放在 ProductRowList 裡 */
export default function ProductRow({ product }: { product: Product }) {
  const { price, soldOut, label, shopLine } = useProductView(product);

  return (
    <li>
      <Link
        to={`/product/${product.id}`}
        aria-label={label}
        className="flex items-center gap-3 transition-colors duration-200 active:bg-press active:duration-0"
      >
        {/* 整列只由 Link 的 aria-label 唸一次；aria-hidden 分別掛在有實際盒子的元素上（WebKit 對無盒子的包裝層處理不可靠） */}
        <div aria-hidden="true" className="shrink-0">
          <Photo src={product.images[0]} alt="" className="size-15">
            {soldOut && <div className="absolute inset-0 bg-white/60" />}
          </Photo>
        </div>
        {/* 第二列起的分隔線從文字左緣開始；字放大到擠不下時價格膠囊換到標題下方 */}
        <div aria-hidden="true" className="flex min-h-21 min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-2 py-3 pr-5 [li+li_&]:border-t-[.5px] [li+li_&]:border-separator">
          <div className="min-w-0 flex-1 basis-32">
            <p className="line-clamp-2 text-subhead text-ink">{product.title}</p>
            <p className="mt-0.5 truncate text-footnote text-muted">{shopLine}</p>
          </div>
          <PricePill price={price} muted={soldOut} />
        </div>
      </Link>
    </li>
  );
}

/** 列表列的 `<ul>` 外框；左 padding 20，列右側貼齊螢幕邊 */
export function ProductRowList({ children }: { children: ReactNode }) {
  return <ul className="pl-5">{children}</ul>;
}
