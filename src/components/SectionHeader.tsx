import { Link } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';

interface Props {
  title: string;
  /** 有目的地才顯示 ›，整列可點 */
  to?: string;
  /** 標題上方的小標；全頁最多一個 */
  eyebrow?: string;
  /** 取代預設外距 `mx-5 mt-8 mb-3`（上 32、左右 20、下 12） */
  className?: string;
}

export default function SectionHeader({ title, to, eyebrow, className = 'mx-5 mt-8 mb-3' }: Props) {
  return (
    <div className={className}>
      {eyebrow && <p className="text-footnote font-semibold text-muted">{eyebrow}</p>}
      <h2 className="text-title2 font-bold text-ink">
        {to ? (
          // py-2 與 -my-2 抵銷：熱區撐到 44 高，版面高度不變
          <Link to={to} className="-my-2 flex items-center gap-0.5 py-2 transition-opacity duration-150 active:opacity-60 active:duration-0">
            {title}
            <ChevronRight size={20} strokeWidth={2.6} className="shrink-0 text-muted" aria-hidden="true" />
          </Link>
        ) : (
          title
        )}
      </h2>
    </div>
  );
}
