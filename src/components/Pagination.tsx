import { focusRing } from './import/ui';

export const PAGE_SIZES = [20, 50, 100] as const;
export type PageSize = (typeof PAGE_SIZES)[number];
export const DEFAULT_PAGE_SIZE: PageSize = PAGE_SIZES[0];

/** 網址上的每頁筆數：不在 20／50／100 之內就取最接近的（平手取較小），讀不出數字就用預設 */
export function parseSize(raw: string | null): PageSize {
  const n = raw === null || raw.trim() === '' ? NaN : Number(raw);
  if (!Number.isFinite(n)) return DEFAULT_PAGE_SIZE;
  return PAGE_SIZES.reduce((best, s) => (Math.abs(s - n) < Math.abs(best - n) ? s : best), DEFAULT_PAGE_SIZE);
}

/** 網址上的頁碼：負數、0、非數字一律當第 1 頁；超出上限由 clampPage 處理（要等資料載完才知道上限） */
export function parsePage(raw: string | null): number {
  const n = raw === null || raw.trim() === '' ? NaN : Number(raw);
  return Number.isFinite(n) ? Math.max(1, Math.floor(n)) : 1;
}

export const totalPagesOf = (total: number, size: number) => Math.max(1, Math.ceil(total / size));
export const clampPage = (page: number, totalPages: number) => Math.min(Math.max(1, page), totalPages);

/**
 * 桌機頁碼列：第一頁、最後一頁、目前頁與前後各 1 頁；中間缺口用 'gap'。
 * 缺口只有 1 頁時直接顯示那一頁（用省略號藏一個數字沒有意義）。
 */
export function pageItems(current: number, total: number): (number | 'gap')[] {
  const wanted = [...new Set([1, current - 1, current, current + 1, total])]
    .filter(p => p >= 1 && p <= total)
    .sort((a, b) => a - b);
  const items: (number | 'gap')[] = [];
  wanted.forEach((p, i) => {
    const prev = wanted[i - 1];
    if (prev !== undefined && p - prev === 2) items.push(prev + 1);
    else if (prev !== undefined && p - prev > 2) items.push('gap');
    items.push(p);
  });
  return items;
}

interface Props {
  page: number;
  totalPages: number;
  size: PageSize;
  /** 篩選後的總件數；決定要不要顯示每頁筆數切換 */
  total: number;
  onPage: (page: number) => void;
  onSize: (size: PageSize) => void;
}

const step = `inline-flex min-h-11 items-center justify-center rounded-sm border border-line bg-white px-4 text-sm hover:bg-canvas disabled:cursor-not-allowed disabled:bg-canvas disabled:text-disabled disabled:hover:bg-canvas ${focusRing}`;
const numBtn = `inline-flex min-h-11 min-w-11 items-center justify-center rounded-sm px-2 text-sm ${focusRing}`;

export default function Pagination({ page, totalPages, size, total, onPage, onSize }: Props) {
  const showNav = totalPages > 1;
  const showSize = total > PAGE_SIZES[0];
  if (!showNav && !showSize) return null;

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-3 py-3 md:px-4">
      {showNav ? (
        <nav aria-label="商品分頁" className="flex items-center gap-1.5">
          <button type="button" className={step} disabled={page <= 1} onClick={() => onPage(page - 1)}>上一頁</button>

          <ol className="hidden items-center gap-1.5 md:flex">
            {pageItems(page, totalPages).map((it, i) => (
              <li key={it === 'gap' ? `gap-${i}` : it}>
                {it === 'gap' ? (
                  <span className="inline-flex min-h-11 min-w-8 items-center justify-center text-muted" aria-hidden="true">…</span>
                ) : (
                  <button
                    type="button"
                    aria-label={`第 ${it} 頁`}
                    aria-current={it === page ? 'page' : undefined}
                    onClick={() => onPage(it)}
                    className={`${numBtn} ${it === page ? 'bg-brand text-white' : 'border border-line bg-white hover:bg-canvas'}`}>
                    {it}
                  </button>
                )}
              </li>
            ))}
          </ol>

          <span className="min-w-16 px-2 text-center text-sm md:hidden" aria-label={`第 ${page} 頁，共 ${totalPages} 頁`}>
            {page} / {totalPages}
          </span>

          <button type="button" className={step} disabled={page >= totalPages} onClick={() => onPage(page + 1)}>下一頁</button>
        </nav>
      ) : <span />}

      {showSize && (
        <label className="flex items-center gap-2 text-sm text-muted">
          每頁
          <select
            value={size}
            onChange={e => onSize(parseSize(e.target.value))}
            className={`min-h-11 rounded-sm border border-line bg-white px-2 text-ink ${focusRing}`}>
            {PAGE_SIZES.map(s => <option key={s} value={s}>{s} 件</option>)}
          </select>
        </label>
      )}
    </div>
  );
}
