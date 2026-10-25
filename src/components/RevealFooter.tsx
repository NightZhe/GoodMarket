import { pillPress } from './pillButton';

/** 列表底部整列寬的膠囊（桌機置中固定寬）；「顯示更多商品」與「回到頂端」共用同一個外觀 */
function FooterPill({ onClick, children }: { onClick: () => void; children: string }) {
  return (
    <div className="px-5 pt-6">
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

/** 瀏覽器沒有 IntersectionObserver 時的退回按鈕（無限捲動做不了） */
export const MoreButton = ({ onClick }: { onClick: () => void }) => <FooterPill onClick={onClick}>顯示更多商品</FooterPill>;

/** 畫到最後一件時的收尾：捲回頁面最頂 */
export const BackToTopButton = ({ onClick }: { onClick: () => void }) => <FooterPill onClick={onClick}>回到頂端</FooterPill>;
