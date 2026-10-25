import type { ComponentType, ReactNode } from 'react';
import { Baby, CarFront, Gamepad2, Gift, Headphones, LayoutGrid, Shirt, Sofa, Tent } from 'lucide-react';
import type { CategoryId } from '../types';

// D6：分類圖示一律單色線條（跟著文字色 currentColor），不用 emoji、不用彩色。
// 圖示只是裝飾，名稱由旁邊的文字提供，所以一律 aria-hidden。

export interface CategoryIconProps {
  size?: number;
  className?: string;
  strokeWidth?: number;
}

type IconComponent = ComponentType<CategoryIconProps>;

// lucide 沒有洋裝、口紅：路徑取自 mock-appstore.html 的 <symbol id="i-c-women"> / <symbol id="i-c-beauty">（viewBox 24）。
function glyph(children: ReactNode): IconComponent {
  return function Glyph({ size = 18, className, strokeWidth = 1.7 }) {
    return (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
        className={className}
        aria-hidden="true"
      >
        {children}
      </svg>
    );
  };
}

const Dress = glyph(
  <>
    <path d="M9.6 3.6h4.8M10 3.6l.4 3.6-4.2 13.2h11.6L13.6 7.2 14 3.6" />
    <path d="M10.4 7.2h3.2" />
  </>,
);

const Lipstick = glyph(
  <>
    <rect x="8" y="12" width="8" height="8.6" rx="1.6" />
    <path d="M9.6 12V7.8l4.8-3.4V12" />
  </>,
);

export const CATEGORY_ICONS: Record<CategoryId, IconComponent> = {
  women: Dress,
  men: Shirt,
  beauty: Lipstick,
  '3c': Headphones,
  home: Sofa,
  food: Gift,
  sports: Tent,
  baby: Baby,
  games: Gamepad2,
  toys: CarFront,
  other: LayoutGrid,
};

export function CategoryIcon({ id, size = 18, className, strokeWidth = 1.7 }: CategoryIconProps & { id: CategoryId }) {
  const Icon = CATEGORY_ICONS[id];
  return <Icon size={size} className={className} strokeWidth={strokeWidth} />;
}
