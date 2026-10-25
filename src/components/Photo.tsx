import type { ReactNode } from 'react';
import ProductImage from './ProductImage';

interface Props {
  src: string;
  alt: string;
  /** 尺寸與比例寫在這裡（例：`aspect-square`、`size-15`）。含 `rounded` 開頭的 class 時取代預設圓角 */
  className?: string;
  size?: 'sm' | 'md' | 'lg';
  /** 疊在照片上的內容（例：已售完壓暗層）；位於內描邊之下 */
  children?: ReactNode;
  /** 圖片載入失敗（例：規格圖壞掉時退回圖庫） */
  onError?: () => void;
}

/** 商品照框：圓角、灰底佔位、0.5px 內描邊（白底商品照才不會溶進白底頁面） */
export default function Photo({ src, alt, className = '', size, children, onError }: Props) {
  const radius = /(^|\s)rounded/.test(className) ? '' : 'rounded-card';
  return (
    <div className={`relative overflow-hidden bg-canvas ${radius} ${className}`}>
      <ProductImage src={src} alt={alt} size={size} onError={onError} className="h-full w-full" />
      {children}
      {/* 內描邊放在獨立一層：<img> 自己的 inset shadow 會被圖蓋掉 */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 rounded-[inherit] shadow-[inset_0_0_0_.5px_rgb(0_0_0/.08)]"
      />
    </div>
  );
}
