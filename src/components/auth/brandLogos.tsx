// Google、Apple 的登入按鈕標誌，集中在這一個檔案。素材都是官方檔，沒有修改（來源與規則見 src/assets/auth/README.md）。
//
// Google：官方檔是 40×40 的整顆按鈕，G 在 (10,10)～(30,30)；官方允許只取出 G。這裡用 overflow 裁切，只露出 G，
//   標誌圖形本身沒有任何修改。用 <img> 載入含 foreignObject 的 SVG，WebKit 與 Chromium 都已實測能正確顯示漸層。
// Apple：HIG 規定標誌檔不得裁切、不得加垂直 padding、高度等於按鈕高度，所以這裡直接用整個檔案（31×44），
//   由按鈕（AuthButton）把它的高度撐到跟按鈕一樣高。

import appleLogoFile from '../../assets/auth/apple-left-black-medium.svg';
import googleSquare from '../../assets/auth/google-light-square.svg';

/** 官方按鈕檔的邊長，與 G 在檔案裡的位置與大小 */
const FILE = 40;
const G_OFFSET = 10;
const G_SIZE = 20;

/** Google 官方 web 規格的 G 是 20px */
export function GoogleLogo({ size = G_SIZE }: { size?: number }) {
  const scale = size / G_SIZE;
  return (
    <span aria-hidden="true" className="relative block shrink-0 overflow-hidden" style={{ width: size, height: size }}>
      <img
        src={googleSquare} alt="" draggable={false}
        className="absolute max-w-none select-none"
        style={{ width: FILE * scale, height: FILE * scale, left: -G_OFFSET * scale, top: -G_OFFSET * scale }}
      />
    </span>
  );
}

/** Apple 官方標誌檔（31×44）的長寬比；高度由呼叫端決定（＝按鈕高度） */
export const APPLE_LOGO_RATIO = 31 / 44;

export function AppleLogo({ height }: { height: number }) {
  return (
    <img
      src={appleLogoFile} alt="" aria-hidden="true" draggable={false}
      width={Math.round(height * APPLE_LOGO_RATIO * 100) / 100} height={height}
      style={{ height }}
      className="block max-w-none shrink-0 select-none"
    />
  );
}
