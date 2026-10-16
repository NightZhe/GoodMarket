import { useEffect, useRef, useState } from 'react';
import { CircleAlert, Copy, EyeOff, LoaderCircle } from 'lucide-react';
import ProductImage from '../ProductImage';
import { useToast } from '../Toast';
import { btnOutline, btnPrimary } from '../import/ui';
import { replyReview } from '../../lib/reviews/api';
import { ReviewError, replyErrorMessage } from '../../lib/reviews/errors';
import { contentLength } from '../../lib/reviews/form';
import { taipeiDateTime } from '../../lib/reviews/format';
import { MAX_CONTENT, type ReplyResult, type SellerReview } from '../../lib/reviews/types';
import { Avatar } from './ReviewCard';
import PhotoThumbs from './PhotoThumbs';
import { StarsDisplay } from './Stars';

interface Props {
  review: SellerReview;
  onReplied: (result: ReplyResult) => void;
  /** 資料庫說這則評價已被隱藏：把卡片切成隱藏樣式 */
  onHidden: (id: string) => void;
  onReload: () => void;
  onOpenPhoto: (paths: string[], index: number, trigger: HTMLButtonElement) => void;
}

const REPLY_MIN = 1;

/** 賣家後台的評價卡（S-6b）：完整暱稱、訂單編號、回覆與修改回覆 */
export default function SellerReviewCard({ review: r, onReplied, onHidden, onReload, onOpenPhoto }: Props) {
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ message: string; code: ReviewError['code'] } | null>(null);
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const editBtnRef = useRef<HTMLButtonElement>(null);
  const replyBtnRef = useRef<HTMLButtonElement>(null);
  const focusAfter = useRef<'edit' | 'reply' | null>(null);

  const len = contentLength(text);
  const over = len - MAX_CONTENT;
  const invalid = len < REPLY_MIN || over > 0;
  const hasReply = r.seller_reply !== null;

  useEffect(() => {
    if (editing) areaRef.current?.focus();
  }, [editing]);

  useEffect(() => {
    if (editing || !focusAfter.current) return;
    (focusAfter.current === 'edit' ? editBtnRef.current : replyBtnRef.current)?.focus();
    focusAfter.current = null;
  }, [editing, hasReply]);

  const open = (initial: string) => { setText(initial); setError(null); setEditing(true); };
  const cancel = () => { focusAfter.current = hasReply ? 'edit' : 'reply'; setEditing(false); setError(null); };

  const submit = async () => {
    if (busy) return;
    if (invalid) { areaRef.current?.focus(); return; }
    setBusy(true);
    setError(null);
    try {
      const res = await replyReview(r.id, text.trim());
      toast(hasReply ? '已更新回覆' : '已送出回覆');
      focusAfter.current = 'edit';
      setEditing(false);
      onReplied(res);
    } catch (e) {
      const code = e instanceof ReviewError ? e.code : null;
      setError({ message: replyErrorMessage(code), code });
      if (code === 'REVIEW_HIDDEN') { setEditing(false); onHidden(r.id); }
    } finally {
      setBusy(false);
    }
  };

  const copyOrderNo = async () => {
    try {
      await navigator.clipboard.writeText(r.order_no);
      toast('已複製訂單編號');
    } catch {
      toast('無法複製，請長按編號選取');
    }
  };

  return (
    <article className="p-4 md:p-5">
      <div className="md:max-w-3xl">
        <div className="flex items-center gap-2">
          <Avatar />
          <p className="min-w-0 truncate text-sm font-medium">{r.display_name}</p>
        </div>
        <div className="mt-1.5"><StarsDisplay value={r.rating} /></div>
        {r.variant_names.length > 0 && <p className="mt-1 text-xs text-muted">規格：{r.variant_names.join('、')}</p>}

        <div className="mt-2 flex items-center gap-2 rounded-sm bg-canvas p-2">
          <ProductImage src={r.product_image} alt="" size="sm" className="w-10 shrink-0 rounded-sm" />
          <p className="line-clamp-2 min-w-0 flex-1 text-xs">
            <span className="sr-only">商品：</span>{r.product_title}
          </p>
        </div>

        {r.content !== '' && <p className="mt-2 whitespace-pre-line break-words text-sm leading-6">{r.content}</p>}
        <PhotoThumbs paths={r.photos} onOpen={(i, el) => onOpenPhoto(r.photos, i, el)} />

        <p className="mt-2.5 text-xs text-muted">{taipeiDateTime(r.created_at)}</p>
        <p className="mt-0.5 flex items-center gap-1 text-xs text-muted">
          訂單編號<span className="select-all font-mono text-ink">{r.order_no}</span>
          <button
            type="button" onClick={() => void copyOrderNo()} aria-label="複製訂單編號"
            className="-my-3 flex h-11 w-11 items-center justify-center rounded-sm text-muted hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
          >
            <Copy size={16} aria-hidden="true" />
          </button>
        </p>

        {r.hidden && (
          <div className="mt-3 flex items-start gap-2 rounded-sm bg-canvas px-3 py-2 text-sm">
            <EyeOff size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
            <p><span className="font-medium">已被平台隱藏</span>　這則評價不會公開，也不計入評分，無法回覆。</p>
          </div>
        )}

        {hasReply && !editing && (
          <div className="mt-3 rounded-sm border border-line bg-subtle p-3">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-medium">
                你的回覆{r.seller_replied_at && <span className="ml-2 font-normal text-muted">{taipeiDateTime(r.seller_replied_at)}</span>}
              </p>
              {!r.hidden && (
                <button
                  ref={editBtnRef} type="button" onClick={() => open(r.seller_reply ?? '')}
                  className="-my-2 -mr-2 inline-flex min-h-11 items-center px-3 text-sm underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
                >
                  修改<span className="sr-only">回覆</span>
                </button>
              )}
            </div>
            <p className="mt-0.5 whitespace-pre-line break-words text-sm leading-6">{r.seller_reply}</p>
          </div>
        )}

        {editing && (
          <div className="mt-3">
            <label htmlFor={`reply-${r.id}`} className="text-sm font-medium">回覆買家</label>
            <textarea
              id={`reply-${r.id}`} ref={areaRef} rows={3} value={text} readOnly={busy}
              onChange={e => setText(e.target.value)}
              aria-invalid={over > 0 || undefined}
              className={`mt-2 block min-h-24 w-full scroll-mt-20 resize-y rounded-sm border bg-subtle px-3 py-2.5 text-base leading-6 outline-none focus:bg-white ${over > 0 ? 'border-error-border' : 'border-line focus:border-ink'}`}
            />
            <div className="mt-1 flex items-start justify-between gap-3 text-xs">
              <span className="flex items-start gap-1 text-error-text">
                {over > 0 && <><CircleAlert size={14} className="mt-0.5 shrink-0" aria-hidden="true" />回覆最多 {MAX_CONTENT} 字，目前超過 {over} 字</>}
              </span>
              <span className={`shrink-0 tabular-nums ${over > 0 ? 'text-error-text' : 'text-muted'}`}>{len} / {MAX_CONTENT}</span>
            </div>
            <div className="mt-3 flex justify-end gap-2">
              <button type="button" onClick={busy ? undefined : cancel} aria-disabled={busy || undefined} className={btnOutline}>取消</button>
              <button
                type="button" onClick={() => void submit()} aria-disabled={busy || invalid || undefined}
                className={btnPrimary}
              >
                {busy && <LoaderCircle size={16} className="motion-safe:animate-spin" aria-hidden="true" />}
                {busy ? '送出中…' : hasReply ? '儲存回覆' : '送出回覆'}
              </button>
            </div>
          </div>
        )}

        {error && (
          <p role="alert" className="mt-2 flex items-start gap-1.5 text-sm text-error-text">
            <CircleAlert size={14} className="mt-1 shrink-0" aria-hidden="true" />
            <span>
              {error.message}
              {error.code === 'REVIEW_NOT_FOUND' && (
                <button type="button" onClick={onReload} className="ml-2 min-h-11 underline underline-offset-2">重新整理列表</button>
              )}
            </span>
          </p>
        )}

        {!hasReply && !r.hidden && !editing && (
          <div className="mt-3 flex justify-end">
            <button ref={replyBtnRef} data-reply-btn type="button" onClick={() => open('')} className={`${btnOutline} px-6`}>
              回覆<span className="sr-only">這則評價（{r.display_name}）</span>
            </button>
          </div>
        )}
      </div>
    </article>
  );
}
