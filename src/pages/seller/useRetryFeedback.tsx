import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * 賣家中心「讀不到 → 重試」的讀屏回饋（商品、訂單、總覽三頁共用）。
 * 重試做完呼叫 finishRetry()：還讀不到（failed）→ 橫幅還在，把 failMessage 再念一次；
 * 讀到了 → 橫幅消失、按鈕跟著不見，焦點移到標題（不能掉到 body），並清空 live region，
 * 否則讀屏逐項滑到頁尾還會念到一句已經過時的錯誤。
 * say 給頁面自己要念的其他訊息用（商品頁的快改結果）。
 */
export function useRetryFeedback(failed: boolean, failMessage: string) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [announce, setAnnounce] = useState({ id: 0, text: '' });
  const say = useCallback((text: string) => setAnnounce(prev => ({ id: prev.id + 1, text })), []);
  const [retryDone, setRetryDone] = useState(0);
  const finishRetry = useCallback(() => setRetryDone(n => n + 1), []);
  const handled = useRef(0);
  useEffect(() => {
    if (handled.current === retryDone) return;
    handled.current = retryDone;
    if (failed) { say(failMessage); return; }
    say('');
    headingRef.current?.focus();
  }, [retryDone, failed, failMessage, say]);
  return { headingRef, announce, say, finishRetry };
}

/** 給讀屏用的隱藏 live region。key 跟著 id 換：同一句話重複出現也會再念一次 */
export function RetryLiveRegion({ announce }: { announce: { id: number; text: string } }) {
  return (
    <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">
      <span key={announce.id}>{announce.text}</span>
    </div>
  );
}
