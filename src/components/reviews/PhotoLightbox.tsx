import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, ImageOff, LoaderCircle, X } from 'lucide-react';
import { reviewPhotoUrl } from '../../lib/reviews/api';
import { reduceMotion } from '../../lib/ui/scroll';

interface Props {
  paths: string[];
  /** 路徑 → 圖片網址。預設是評價照片（公開 bucket）；聊聊是私有 bucket 的簽名網址，由呼叫端傳入 */
  urlFor?: (path: string) => string;
  /** 圖片載入失敗、使用者按「重試」時呼叫（聊聊用來重換過期的簽名網址）。沒給就在網址後面加 ?r= 重新請求（評價的做法） */
  onReload?: (path: string) => void;
  /** 對話框名稱與每張圖的 alt／朗讀前綴；預設「評價照片」 */
  noun?: string;
  startIndex: number;
  /** 關閉後把焦點還給原本點的縮圖 */
  returnFocusTo: HTMLElement | null;
  onClose: () => void;
}

/**
 * 全螢幕大圖檢視器（買家與賣家共用，S-7）。
 * 手機滑動＝瀏覽器原生橫向捲動＋scroll-snap（慣性、回彈都是原生的，不自己寫手勢）；
 * 桌機用方向鍵或左右按鈕。程式觸發的捲動在「減少動態效果」下瞬間切換。
 * 全螢幕遮罩蓋到螢幕邊，但右上關閉鈕要讓開直立軌與系統欄：頂列左右各自吃 --inset-l／--inset-r（側邊姿態時系統欄那側＝軌欄寬）。
 * 關閉鈕貼右緣、計數貼左緣，都不在水平或垂直的中線帶（D13）內。
 */
export default function PhotoLightbox({ paths, urlFor = reviewPhotoUrl, onReload, noun = '評價照片', startIndex, returnFocusTo, onClose }: Props) {
  const total = paths.length;
  const [index, setIndex] = useState(startIndex);
  const scroller = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const prevRef = useRef<HTMLButtonElement>(null);
  const nextRef = useRef<HTMLButtonElement>(null);
  const raf = useRef(0);
  const [retry, setRetry] = useState<Record<number, number>>({});
  const [state, setState] = useState<Record<number, 'loaded' | 'error'>>({});

  // 開啟：鎖背景捲動、焦點移到關閉鈕、捲到起始張；關閉：還原並把焦點還給縮圖
  useEffect(() => {
    const html = document.documentElement;
    const before = html.style.overflow;
    html.style.overflow = 'hidden';
    closeRef.current?.focus();
    const el = scroller.current;
    if (el) el.scrollLeft = startIndex * el.clientWidth;
    return () => {
      html.style.overflow = before;
      returnFocusTo?.focus();
      cancelAnimationFrame(raf.current);
    };
  }, [startIndex, returnFocusTo]);

  const goTo = useCallback((i: number) => {
    const el = scroller.current;
    if (!el || i < 0 || i >= total) return;
    el.scrollTo({ left: i * el.clientWidth, behavior: reduceMotion() ? 'auto' : 'smooth' });
  }, [total]);

  const onScroll = () => {
    cancelAnimationFrame(raf.current);
    raf.current = requestAnimationFrame(() => {
      const el = scroller.current;
      if (!el || el.clientWidth === 0) return;
      setIndex(Math.max(0, Math.min(total - 1, Math.round(el.scrollLeft / el.clientWidth))));
    });
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { e.stopPropagation(); onClose(); return; }
    if (e.key === 'ArrowLeft') { e.preventDefault(); goTo(index - 1); return; }
    if (e.key === 'ArrowRight') { e.preventDefault(); goTo(index + 1); return; }
    if (e.key !== 'Tab') return;
    // 焦點圈：只在「關閉／上一張／下一張」之間循環
    const stops = [closeRef.current, prevRef.current, nextRef.current]
      .filter((b): b is HTMLButtonElement => b !== null && b.getAttribute('aria-disabled') !== 'true');
    if (stops.length === 0) return;
    const at = stops.indexOf(document.activeElement as HTMLButtonElement);
    const next = e.shiftKey ? (at <= 0 ? stops.length - 1 : at - 1) : (at === stops.length - 1 ? 0 : at + 1);
    e.preventDefault();
    stops[next].focus();
  };

  const atFirst = index === 0;
  const atLast = index === total - 1;

  // 滑到頭尾時，原本按著的箭頭會變成看不見：把焦點移回關閉鈕，免得焦點掉到頁面上
  useEffect(() => {
    const a = document.activeElement;
    if ((atFirst && a === prevRef.current) || (atLast && a === nextRef.current)) closeRef.current?.focus();
  }, [atFirst, atLast]);

  return (
    <div
      role="dialog" aria-modal="true" aria-label={`${noun}檢視`} onKeyDown={onKeyDown}
      className="animate-fade fixed inset-0 z-[60] flex flex-col bg-black/90"
    >
      <div className="flex items-center justify-between pl-[max(0.5rem,var(--inset-l))] pr-[max(0.5rem,var(--inset-r))] pt-[max(env(safe-area-inset-top),0.5rem)] text-white">
        <span className="px-3 text-sm tabular-nums" aria-hidden="true">{index + 1} / {total}</span>
        <button
          ref={closeRef} type="button" onClick={onClose} aria-label="關閉"
          className="flex h-11 w-11 items-center justify-center rounded-full hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
        >
          <X size={24} aria-hidden="true" />
        </button>
      </div>

      <div className="relative flex min-h-0 flex-1 items-center justify-center">
        <div
          ref={scroller} onScroll={onScroll}
          className="no-scrollbar flex h-full w-full snap-x snap-mandatory overflow-x-auto"
        >
          {paths.map((p, i) => (
            <div
              key={p}
              onClick={e => { if (e.target === e.currentTarget) onClose(); }}
              className="relative flex h-full w-full shrink-0 snap-center items-center justify-center p-2"
            >
              {state[i] === 'error' ? (
                <div className="flex flex-col items-center gap-2 text-white">
                  <ImageOff size={32} className="text-white/70" aria-hidden="true" />
                  <p className="text-sm">照片無法載入</p>
                  <button
                    type="button"
                    onClick={() => { setState(s => { const n = { ...s }; delete n[i]; return n; }); if (onReload) onReload(p); else setRetry(r => ({ ...r, [i]: (r[i] ?? 0) + 1 })); }}
                    className="min-h-11 px-4 text-sm underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
                  >
                    重試
                  </button>
                </div>
              ) : (
                <>
                  {state[i] !== 'loaded' && (
                    <LoaderCircle size={28} aria-hidden="true" className="absolute text-white/70 motion-safe:animate-spin" />
                  )}
                  <img
                    src={`${urlFor(p)}${retry[i] ? `?r=${retry[i]}` : ''}`}
                    alt={`${noun} ${i + 1}，共 ${total} 張`}
                    onLoad={() => setState(s => ({ ...s, [i]: 'loaded' }))}
                    onError={() => setState(s => ({ ...s, [i]: 'error' }))}
                    className="max-h-full max-w-full object-contain"
                  />
                </>
              )}
            </div>
          ))}
        </div>

        {total > 1 && (
          <>
            {/* 手機沒有箭頭（用滑的），但按鈕仍在 DOM 裡，讀屏與外接鍵盤找得到 */}
            <button
              ref={prevRef} type="button" onClick={() => goTo(index - 1)} aria-label="上一張" aria-disabled={atFirst || undefined}
              className={`sr-only md:not-sr-only md:absolute md:left-4 md:flex md:h-12 md:w-12 md:items-center md:justify-center md:rounded-full md:bg-white/10 md:text-white md:hover:bg-white/20 md:focus-visible:outline-2 md:focus-visible:outline-offset-2 md:focus-visible:outline-white ${atFirst ? 'md:invisible' : ''}`}
            >
              <ChevronLeft size={28} aria-hidden="true" />
            </button>
            <button
              ref={nextRef} type="button" onClick={() => goTo(index + 1)} aria-label="下一張" aria-disabled={atLast || undefined}
              className={`sr-only md:not-sr-only md:absolute md:right-4 md:flex md:h-12 md:w-12 md:items-center md:justify-center md:rounded-full md:bg-white/10 md:text-white md:hover:bg-white/20 md:focus-visible:outline-2 md:focus-visible:outline-offset-2 md:focus-visible:outline-white ${atLast ? 'md:invisible' : ''}`}
            >
              <ChevronRight size={28} aria-hidden="true" />
            </button>
          </>
        )}
      </div>
      <p role="status" className="sr-only">{noun} {index + 1}，共 {total} 張</p>
    </div>
  );
}
