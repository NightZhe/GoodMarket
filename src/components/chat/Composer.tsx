import { useEffect, useId, useRef, useState } from 'react';
import { ArrowUp, CircleAlert, Image as ImageIcon, LoaderCircle, X } from 'lucide-react';
import { CardThumb } from './MessageCard';
import { usePhotoDraft } from './usePhotoDraft';
import { pendingCardKicker, pendingCardSpoken } from '../../lib/chat/cards';
import { MAX_TEXT, canSubmit, textLength } from '../../lib/chat/outbox';
import { pickPhotosNative } from '../../lib/native/photos';
import { isNative } from '../../lib/native/platform';
import type { OutgoingPhoto } from '../../lib/chat/useConversation';
import type { ChatCard } from '../../lib/chat/types';
import { money } from '../../lib/format';
import { cardPrice } from '../../lib/chat/cards';
import { pillPress } from '../pillButton';

/** 輸入列為什麼停用（placeholder 與朗讀的原因）。null＝可用 */
export type ComposerBlock = 'loading' | 'offline' | 'blocked' | 'gone' | null;

const PLACEHOLDER: Record<Exclude<ComposerBlock, null>, string> = {
  loading: '輸入訊息', offline: '目前離線', blocked: '解除封鎖後才能傳送', gone: '無法傳送',
};

interface Props {
  block: ComposerBlock;
  /** 停用原因那一條狀態列的 id（aria-describedby，讀屏念得出原因） */
  reasonId?: string;
  pendingCard: ChatCard | null;
  /** 待送出卡片能不能移除；店主從訂單發起新對話時不行（§6.4） */
  cardRemovable: boolean;
  onRemoveCard: () => void;
  onSend: (input: { text: string; photos: OutgoingPhoto[] }) => void;
  /** 父層要求把焦點放回輸入框（例如解除封鎖之後）；值改變就聚焦 */
  focusToken: number;
  /** 賣家桌機的提示語「輸入訊息，Enter 傳送」 */
  desktopHint?: boolean;
}

const MAX_ROWS_PX = 140;

/** 輸入列（兩端共用）：待送出卡片、圖片預覽、文字框、圖片鈕、送出鈕。輸入列永遠存在，停用時只是換樣子，版面不跳 */
export default function Composer({
  block, reasonId, pendingCard, cardRemovable, onRemoveCard, onSend, focusToken, desktopHint = false,
}: Props) {
  const [text, setText] = useState('');
  const draft = usePhotoDraft();
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const hintId = useId();
  const errId = useId();
  const disabled = block !== null;
  const len = textLength(text);
  const over = len > MAX_TEXT;

  // 文字框自動長高到 5 行，超過內捲
  useEffect(() => {
    const el = areaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, MAX_ROWS_PX)}px`;
  }, [text]);

  const firstFocus = useRef(true);
  useEffect(() => {
    if (firstFocus.current) { firstFocus.current = false; return; }
    areaRef.current?.focus();
  }, [focusToken]);

  const can = canSubmit({
    text, hasCard: pendingCard !== null, photoCount: draft.photos.length, processing: draft.processing,
    online: block !== 'offline', blockedByMe: block === 'blocked', peerDeleted: block === 'gone',
  }) && block !== 'loading';

  const submit = () => {
    if (!can) return;
    onSend({ text, photos: draft.take() });
    setText('');
    areaRef.current?.focus();
  };

  const openPicker = async () => {
    if (disabled) return;
    if (draft.full) { draft.setError('圖片最多 5 張'); return; }
    if (!isNative()) { fileRef.current?.click(); return; }
    const r = await pickPhotosNative(5 - draft.photos.length);
    if (r.kind === 'picked') draft.add(r.files);
    else if (r.kind === 'failed') draft.setError('無法開啟相簿，請到『設定 › 好物集 › 照片』允許存取');
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // 桌機：Enter 送出、Shift+Enter 換行；輸入法組字中（選字）的 Enter 一律不送。手機的 Enter 就是換行，用送出鈕送
    if (e.key !== 'Enter' || e.shiftKey || e.nativeEvent.isComposing || e.keyCode === 229) return;
    if (!window.matchMedia('(pointer: fine)').matches) return;
    e.preventDefault();
    submit();
  };

  const placeholder = block ? PLACEHOLDER[block] : desktopHint ? '輸入訊息，Enter 傳送' : '輸入訊息';

  return (
    <form
      aria-label="傳送訊息"
      onSubmit={e => { e.preventDefault(); submit(); }}
      className="material @container shrink-0 border-t-[0.5px] border-separator px-3 pb-[max(env(safe-area-inset-bottom),8px)] pt-2"
    >
      {pendingCard && (
        <div className="mb-2 flex items-center gap-2 rounded-card border-[0.5px] border-separator bg-white p-2">
          <span className="sr-only">{pendingCardSpoken(pendingCard, cardRemovable)}</span>
          <span aria-hidden="true" className="flex min-w-0 flex-1 items-center gap-2">
            <CardThumb src={pendingCard.image} size="size-10" />
            <span className="min-w-0 flex-1">
              <span className="block text-caption2 font-semibold text-muted">{pendingCardKicker(pendingCard)}</span>
              <span className="block truncate text-subhead text-ink">{pendingCard.title}</span>
              {cardPrice(pendingCard) !== null && <span className="block text-footnote font-semibold text-ink">{money(cardPrice(pendingCard) as number)}</span>}
            </span>
          </span>
          {cardRemovable && (
            <button
              type="button"
              aria-label={pendingCard.type === 'product' ? '移除商品卡' : '移除訂單卡'}
              onClick={() => { onRemoveCard(); areaRef.current?.focus(); }}
              className="grid size-11 shrink-0 place-items-center text-muted"
            >
              <X size={24} aria-hidden="true" />
            </button>
          )}
        </div>
      )}
      {pendingCard && !cardRemovable && (
        <p className="mb-2 text-footnote text-muted">第一則訊息會附上這筆訂單</p>
      )}

      {draft.error && (
        <p id={errId} role="alert" className="mb-2 flex items-start gap-1.5 text-footnote text-error-text">
          <CircleAlert size={16} className="mt-px shrink-0" aria-hidden="true" />{draft.error}
        </p>
      )}
      {draft.photos.length > 0 && (
        <div className="mb-2 flex items-center gap-3">
          <ul className="no-scrollbar flex min-w-0 flex-1 gap-3 overflow-x-auto pb-1 pt-3">
            {draft.photos.map((p, i) => (
              <li key={p.key} className="relative size-14 shrink-0">
                <img src={p.previewUrl} alt={`待送出的圖片 ${i + 1}`} className="size-full rounded-[8px] object-cover" />
                {p.blob === null && (
                  <span className="absolute inset-0 grid place-items-center rounded-[8px] bg-ink/40 text-white">
                    <LoaderCircle size={18} className="motion-safe:animate-spin" aria-hidden="true" />
                  </span>
                )}
                <button
                  type="button"
                  aria-label={`移除圖片 ${i + 1}`}
                  onClick={() => draft.remove(p.key)}
                  className="absolute -right-3 -top-3 grid size-11 place-items-center"
                >
                  <span className="grid size-5 place-items-center rounded-full bg-ink/70 text-white"><X size={12} strokeWidth={2.6} aria-hidden="true" /></span>
                </button>
              </li>
            ))}
          </ul>
          <span aria-hidden="true" className="shrink-0 text-caption2 text-muted">{draft.photos.length}／5</span>
        </div>
      )}

      <div className="flex flex-wrap items-end gap-2">
        <button
          type="button"
          aria-label="選擇圖片"
          aria-disabled={disabled || undefined}
          onClick={() => { void openPicker(); }}
          className={`grid size-11 shrink-0 place-items-center text-brand aria-disabled:text-muted-2 ${pillPress}`}
        >
          <ImageIcon size={24} strokeWidth={1.7} aria-hidden="true" />
        </button>
        <textarea
          ref={areaRef}
          rows={1}
          value={text}
          disabled={disabled}
          placeholder={placeholder}
          aria-label="訊息"
          aria-describedby={[reasonId, over ? hintId : null].filter(Boolean).join(' ') || undefined}
          onChange={e => setText(e.target.value)}
          onKeyDown={onKeyDown}
          className="min-h-11 min-w-0 flex-1 basis-30 resize-none rounded-[10px] bg-search px-3 py-2.5 text-body text-ink outline-none placeholder:text-muted disabled:bg-canvas @max-[15rem]:order-first @max-[15rem]:basis-full"
        />
        <button
          type="submit"
          aria-label="傳送"
          aria-disabled={!can || undefined}
          className={`grid size-11 shrink-0 place-items-center rounded-full ${can ? 'bg-brand text-white active:bg-brand-dark' : 'bg-canvas text-muted-2'} ${pillPress}`}
        >
          <ArrowUp size={20} strokeWidth={2.4} aria-hidden="true" />
        </button>
      </div>
      {len >= 900 && (
        <p aria-hidden="true" className={`mt-1 text-right text-caption2 ${over ? 'text-error-text' : 'text-muted'}`}>{len}／{MAX_TEXT}</p>
      )}
      {over && <p id={hintId} role="alert" className="mt-1 text-footnote text-error-text">最多 1000 字</p>}
      {/* 不加 capture：加了 iPhone 會直接開相機，不能選圖庫 */}
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        multiple
        tabIndex={-1}
        aria-hidden="true"
        className="sr-only"
        onChange={e => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = '';
          if (files.length > 0) draft.add(files);
        }}
      />
    </form>
  );
}
