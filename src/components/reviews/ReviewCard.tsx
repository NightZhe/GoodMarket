import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { User } from 'lucide-react';
import type { PublicReview } from '../../lib/reviews/types';
import { taipeiDate } from '../../lib/reviews/format';
import { StarsDisplay } from './Stars';
import PhotoThumbs from './PhotoThumbs';

interface Props {
  review: PublicReview;
  /** 商品頁只看前幾行，總覽頁看全文 */
  clamp?: boolean;
  /** 賣場評價：多顯示商品名稱 */
  showProduct?: boolean;
  onOpenPhoto: (paths: string[], index: number, trigger: HTMLButtonElement) => void;
  /** 有傳才顯示「檢舉」（買家端）；賣家端重用卡片時不傳 */
  onReport?: (review: PublicReview) => void;
}

export function Avatar() {
  return (
    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-canvas text-muted">
      <User size={16} aria-hidden="true" />
    </span>
  );
}

/** 全文超過 4 行才出現「展開全文」；視窗尺寸改變時重算 */
function ClampedText({ text }: { text: string }) {
  const ref = useRef<HTMLParagraphElement>(null);
  const [open, setOpen] = useState(false);
  const [overflow, setOverflow] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el || open) return;
    const measure = () => setOverflow(el.scrollHeight > el.clientHeight + 1);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [text, open]);

  return (
    <div className="mt-2">
      <p ref={ref} className={`whitespace-pre-line break-words text-sm leading-6 ${open ? '' : 'line-clamp-4'}`}>{text}</p>
      {(overflow || open) && (
        <button
          type="button" aria-expanded={open} onClick={() => setOpen(o => !o)}
          className="min-h-11 text-sm text-ink underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
        >
          {open ? '收合' : '展開全文'}
        </button>
      )}
    </div>
  );
}

export function SellerReplyBlock({ reply, at }: { reply: string; at: string | null }) {
  return (
    <div className="mt-3 rounded-sm border border-line bg-subtle p-3">
      <p className="text-xs font-medium">
        賣家回覆{at && <span className="ml-2 font-normal text-muted">{taipeiDate(at)}</span>}
      </p>
      <p className="mt-1 whitespace-pre-line break-words text-sm leading-6">{reply}</p>
    </div>
  );
}

/** 公開評價卡（商品頁、總覽頁共用）。沒有的欄位整塊不渲染，不留空白 */
export default function ReviewCard({ review: r, clamp = false, showProduct = false, onOpenPhoto, onReport }: Props) {
  return (
    <article className="py-4 md:py-5">
      <div className="flex items-center gap-2">
        <Avatar />
        <p className="min-w-0 truncate text-sm font-medium">{r.display_name}</p>
      </div>
      <div className="md:pl-9">
        <div className="mt-1.5"><StarsDisplay value={r.rating} /></div>
        {r.variant_names.length > 0 && <p className="mt-1 text-xs text-muted">規格：{r.variant_names.join('、')}</p>}
        {showProduct && r.product_title && (
          <p className="mt-1 line-clamp-1 text-xs text-muted">
            商品：
            {r.product_available && r.product_id ? (
              <Link to={`/product/${r.product_id}`} className="text-ink underline underline-offset-2">{r.product_title}</Link>
            ) : (
              <>{r.product_title}（已下架）</>
            )}
          </p>
        )}
        {r.content !== '' && (clamp ? <ClampedText text={r.content} /> : (
          <p className="mt-2 whitespace-pre-line break-words text-sm leading-6">{r.content}</p>
        ))}
        <PhotoThumbs paths={r.photos} onOpen={(i, el) => onOpenPhoto(r.photos, i, el)} />
        {/* 逐則重複的動作要安靜：次要色。-my-3 抵掉 44 高多出的部分，卡片只多 4pt；mt-3 避免熱區蓋到上方照片縮圖 */}
        <div className="mt-3 flex items-center justify-between gap-3">
          <p className="text-xs text-muted">{taipeiDate(r.created_at)}</p>
          {onReport && (
            <button
              type="button" onClick={() => onReport(r)} aria-label={`檢舉 ${r.display_name} 的評價`} aria-haspopup="dialog"
              className="-my-3 -mr-2 inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center px-2 text-footnote text-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
            >
              檢舉
            </button>
          )}
        </div>
        {r.seller_reply && <SellerReplyBlock reply={r.seller_reply} at={r.seller_replied_at} />}
      </div>
    </article>
  );
}
