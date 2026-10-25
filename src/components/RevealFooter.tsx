import type { RefObject } from 'react';
import { pillPress } from './pillButton';

/** 列表底部整列寬的膠囊（桌機置中固定寬）；「顯示更多商品」與「回到頂端」共用同一個外觀 */
function FooterPill({ onClick, children }: { onClick: () => void; children: string }) {
  return (
    <div className="px-5 pb-6 pt-6">
      <button
        type="button"
        onClick={onClick}
        className={`flex h-12.5 w-full items-center justify-center rounded-full bg-canvas text-headline font-semibold text-brand active:bg-press md:mx-auto md:w-80 ${pillPress}`}
      >
        {children}
      </button>
    </div>
  );
}

/** useInfiniteReveal 回傳物件中，列表底部用到的部分 */
interface RevealControls {
  sentinelRef: RefObject<HTMLDivElement | null>;
  showFallback: boolean;
  showMore: () => void;
  showBackToTop: boolean;
  backToTop: () => void;
}

/**
 * 無限捲動列表的底部（首頁與逛逛共用），放在列表最後一件之後：
 * 哨兵（滑近就多畫一批）；沒有 IntersectionObserver 時的「顯示更多商品」退回按鈕；畫到最後一件的「回到頂端」
 */
export function RevealFooter({ reveal }: { reveal: RevealControls }) {
  return (
    <>
      <div ref={reveal.sentinelRef} aria-hidden="true" />
      {reveal.showFallback && <FooterPill onClick={reveal.showMore}>顯示更多商品</FooterPill>}
      {reveal.showBackToTop && <FooterPill onClick={reveal.backToTop}>回到頂端</FooterPill>}
    </>
  );
}
