import { CircleAlert, CircleCheck } from 'lucide-react';
import ProductImage from '../ProductImage';
import type { MyReviewItem } from '../../lib/reviews/types';
import { MAX_CONTENT } from '../../lib/reviews/types';
import { taipeiDate, STAR_WORDS } from '../../lib/reviews/format';
import { contentLength } from '../../lib/reviews/form';
import { maskNickname } from '../../lib/reviews/nickname';
import type { PhotoItem } from '../../lib/reviews/upload';
import { StarInput, StarsDisplay } from './Stars';
import PhotoPicker from './PhotoPicker';
import PhotoThumbs from './PhotoThumbs';
import { SellerReplyBlock } from './ReviewCard';

function ProductRow({ item }: { item: MyReviewItem }) {
  return (
    <div className="flex gap-3 border-b border-line p-4">
      <ProductImage src={item.image} alt="" size="sm" className="w-16 shrink-0 rounded-sm border border-line" />
      <div className="min-w-0 flex-1">
        <p className="break-words text-sm">{item.title}</p>
        {item.variant_names.length > 0 && <p className="mt-0.5 text-xs text-muted">規格：{item.variant_names.join('、')}</p>}
      </div>
    </div>
  );
}

interface EditableProps {
  item: MyReviewItem;
  rating: number;
  content: string;
  photos: PhotoItem[];
  onRating: (n: number) => void;
  onContent: (s: string) => void;
  onAddFiles: (files: File[]) => void;
  onRemovePhoto: (key: string) => void;
  onRetryPhoto: (key: string) => void;
}

/** 可填寫的商品卡：沒打星等只有星等列；打了才展開「文字＋照片」 */
export function EditableItemCard(p: EditableProps) {
  const { item } = p;
  const len = contentLength(p.content);
  const over = len - MAX_CONTENT;
  return (
    <section id={`item-${item.product_id}`} className="mt-2 bg-white md:mt-3 md:rounded-md">
      <ProductRow item={item} />
      <div className={`${p.rating > 0 ? 'space-y-5' : ''} p-4 md:p-6`}>
        <StarInput productName={item.title} value={p.rating} onChange={p.onRating} />
        {p.rating > 0 && (
          <>
            <div>
              <label htmlFor={`content-${item.product_id}`} className="text-sm font-medium">
                評價內容<span className="font-normal text-muted">（選填）</span>
              </label>
              <textarea
                id={`content-${item.product_id}`} rows={4} value={p.content}
                onChange={e => p.onContent(e.target.value)}
                placeholder="品質、和圖片是否相符、使用心得"
                aria-invalid={over > 0 || undefined}
                aria-describedby={over > 0 ? `content-err-${item.product_id}` : undefined}
                className={`mt-2 block min-h-28 w-full scroll-mt-20 resize-y rounded-sm border bg-subtle px-3 py-2.5 text-base leading-6 outline-none placeholder:text-muted focus:bg-white ${over > 0 ? 'border-error-border' : 'border-line focus:border-ink'}`}
              />
              <div className="mt-1 flex items-start justify-between gap-3 text-xs">
                <span id={`content-err-${item.product_id}`} className="flex items-start gap-1 text-error-text">
                  {over > 0 && <><CircleAlert size={14} className="mt-0.5 shrink-0" aria-hidden="true" />評價內容最多 {MAX_CONTENT} 字，目前超過 {over} 字</>}
                </span>
                <span className={`shrink-0 tabular-nums ${over > 0 ? 'text-error-text' : 'text-muted'}`}>{len} / {MAX_CONTENT}</span>
              </div>
            </div>
            <div id={`photos-${item.product_id}`} tabIndex={-1} className="scroll-mt-20 outline-none">
              <PhotoPicker
                productName={item.title} photos={p.photos}
                onAdd={p.onAddFiles} onRemove={p.onRemovePhoto} onRetry={p.onRetryPhoto}
              />
            </div>
          </>
        )}
      </div>
    </section>
  );
}

/** 已評價的商品：唯讀顯示自己送出的內容（含只有買家本人看得到的原始暱稱）與賣家回覆 */
export function ReadonlyItemCard({ item, onOpenPhoto }: {
  item: MyReviewItem;
  onOpenPhoto: (paths: string[], index: number, trigger: HTMLButtonElement) => void;
}) {
  const r = item.review;
  return (
    <section className="mt-2 bg-white md:mt-3 md:rounded-md">
      <ProductRow item={item} />
      {r && (
        <div className="p-4 md:p-6">
          <p className="inline-flex items-center gap-1 rounded-sm border border-line px-1.5 py-0.5 text-xs font-medium">
            <CircleCheck size={12} className="text-success" aria-hidden="true" />已評價
          </p>
          <div className="mt-2 flex items-center gap-2">
            <StarsDisplay value={r.rating} size={20} />
            <span className="text-sm">{STAR_WORDS[r.rating]}</span>
          </div>
          {r.content !== '' && <p className="mt-2 whitespace-pre-line break-words text-sm leading-6">{r.content}</p>}
          <PhotoThumbs paths={r.photos} onOpen={(i, el) => onOpenPhoto(r.photos, i, el)} />
          <p className="mt-2 text-xs text-muted">
            公開顯示為：{r.nickname ? maskNickname(r.nickname) : '匿名買家'}　・　{taipeiDate(r.created_at)}
          </p>
          {r.nickname && <p className="mt-0.5 text-xs text-muted">你填寫的暱稱：{r.nickname}</p>}
          {r.hidden && <p className="mt-2 text-xs text-muted">這則評價目前不公開。</p>}
          {r.seller_reply && <SellerReplyBlock reply={r.seller_reply} at={r.seller_replied_at} />}
        </div>
      )}
    </section>
  );
}
