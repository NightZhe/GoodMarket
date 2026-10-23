/**
 * 膠囊鈕按下動態：縮 .97，按下 100ms、放開 160ms（design-final §3.7）；減少動態時不縮放。
 * Tailwind v4 的 scale-* 寫的是 CSS `scale` 屬性，transition 要列 scale 而不是 transform。
 * 只有動態，不含尺寸與顏色：版面不同的膠囊（例如整列寬的「顯示更多商品」）自己加底色與 active 色
 */
export const pillPress =
  'transition-[scale,background-color] duration-160 ease-[cubic-bezier(.23,1,.32,1)] ' +
  'active:scale-[0.97] active:duration-100 motion-reduce:transition-none motion-reduce:active:scale-100';

const PILL = 'inline-flex h-11 items-center rounded-full px-5 text-headline font-semibold';

/** 灰膠囊鈕（高 44）：次要動作，例如「回首頁」「免費開店」 */
export const pillButton = `${PILL} bg-canvas text-brand active:bg-press ${pillPress}`;

/** 實心膠囊鈕（高 44）：主要動作，例如「重新載入」 */
export const pillButtonPrimary = `${PILL} bg-brand text-white active:bg-brand-dark ${pillPress}`;
