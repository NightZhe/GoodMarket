import { ExternalLink } from 'lucide-react';
import { privacyUrl } from '../../lib/auth/callback';
import { isNative } from '../../lib/native/platform';
import { PUBLIC_SITE } from '../../lib/share/publicUrl';

/** App 內的隱私政策網址：正式站（WebView 的 origin 是本機資產，Android 上 target=_blank 會在同一個 WebView 重載整個 App） */
export const NATIVE_PRIVACY_URL = `${PUBLIC_SITE}#/privacy`;

/**
 * R-21：登入畫面的隱私告知。連結一律另開分頁——同分頁離開會讓商品頁卸載，規格、數量跟待辦動作都會消失。
 * App 內（iOS／Android）WebView 不會開新分頁：改用系統瀏覽器視圖開正式站的隱私政策頁，App 畫面與登入面板都留在原地。
 * 文字行內的連結用負 margin 把點擊區撐到 44px（商品頁既有的做法）。
 */
export default function PrivacyNote({ className = '' }: { className?: string }) {
  const native = isNative();
  const openNative = (e: React.MouseEvent<HTMLAnchorElement>) => {
    e.preventDefault();
    void import('@capacitor/browser').then(({ Browser }) => Browser.open({ url: NATIVE_PRIVACY_URL })).catch(() => { /* 外掛不在就算了 */ });
  };
  return (
    <p className={`text-xs leading-5 text-muted ${className}`}>
      繼續即表示你同意我們依
      <a
        href={native ? NATIVE_PRIVACY_URL : privacyUrl(window.location)} target="_blank" rel="noopener noreferrer"
        onClick={native ? openNative : undefined}
        className="-my-3.5 inline-flex min-h-11 items-center gap-0.5 px-0.5 text-ink underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
      >
        隱私政策
        <ExternalLink size={12} aria-hidden="true" />
        <span className="sr-only">{native ? '（在瀏覽器開啟）' : '（另開新分頁）'}</span>
      </a>
      處理你的資料。
    </p>
  );
}
