import { ExternalLink } from 'lucide-react';
import { privacyUrl } from '../../lib/auth/callback';

/**
 * R-21：登入畫面的隱私告知。連結一律另開分頁——同分頁離開會讓商品頁卸載，規格、數量跟待辦動作都會消失。
 * 文字行內的連結用負 margin 把點擊區撐到 44px（商品頁既有的做法）。
 */
export default function PrivacyNote({ className = '' }: { className?: string }) {
  return (
    <p className={`text-xs leading-5 text-muted ${className}`}>
      繼續即表示你同意我們依
      <a
        href={privacyUrl(window.location)} target="_blank" rel="noopener noreferrer"
        className="-my-3.5 inline-flex min-h-11 items-center gap-0.5 px-0.5 text-ink underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
      >
        隱私政策
        <ExternalLink size={12} aria-hidden="true" />
        <span className="sr-only">（另開新分頁）</span>
      </a>
      處理你的資料。
    </p>
  );
}
