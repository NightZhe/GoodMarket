import { useEffect, useId, useState } from 'react';
import { CircleAlert, Info } from 'lucide-react';
import type { InAppKind } from '../../lib/auth/inapp';
import { btnOutline } from '../import/ui';
import Banner from '../import/Banner';
import type { TurnstileCtl } from './useTurnstile';

/** 「改用 Apple／Google」在內建瀏覽器做不到，換成外開瀏覽器（design C-2 ⑤） */
export function turnstileUnavailableText(inApp: InAppKind | null, ios: boolean): string {
  if (!inApp) return '安全驗證載入失敗，請重新整理，或改用 Apple／Google 登入。';
  return `安全驗證載入失敗，請重新整理，或用${inApp === 'line' && ios ? ' Safari ' : '瀏覽器'}開啟後登入。`;
}

/**
 * C-2 TurnstileSlot：欄位與按鈕之間（S-10 是重新傳送按鈕上方）。預設不渲染任何看得到的東西（0 高度）。
 * 六種狀態：①載入中／通過＝看不到；②需要互動＝標題列＋官方 widget；③失敗可重試；④逾時；⑤載入不了。
 * widget 長出來沒有動畫、不搶焦點（使用者可能正在打字）。
 * needMessage＝「沒勾選就按傳送」的欄位式錯誤句；有值時焦點會被移到容器（由呼叫端呼叫 ctl.focus()）。
 */
export default function TurnstileSlot({ ctl, inApp, ios, where, needMessage, needId }: {
  ctl: TurnstileCtl; inApp: InAppKind | null; ios: boolean;
  /** 讀屏提示裡 widget 在哪（「手機號碼欄位下方」「重新傳送按鈕上方」） */
  where: string;
  needMessage?: string | null; needId?: string;
}) {
  const labelId = useId();
  const interactive = ctl.status === 'interactive' || ctl.status === 'timeout';
  // 勾選完成後官方 widget 還會停著顯示「成功!」，到 token 用掉、widget 重設才收起來：這段時間版面間距要留著
  const [shownWidget, setShownWidget] = useState(false);
  useEffect(() => {
    if (interactive) setShownWidget(true);
    else if (ctl.status === 'loading' || ctl.status === 'off') setShownWidget(false);
  }, [interactive, ctl.status]);
  if (ctl.status === 'off') return null;
  const visible = interactive || ctl.status === 'failed' || ctl.status === 'unavailable' || (ctl.status === 'ready' && shownWidget);

  return (
    <div className={visible ? 'mt-4' : undefined}>
      {/* 畫面載入時就存在、內容空白：事件發生時才塞文字，讀屏才會念（design 7.1） */}
      <p role="status" className="sr-only">{interactive ? `需要完成安全驗證，請在${where}勾選。` : ''}</p>
      {interactive && <p id={labelId} className="mb-2 text-sm font-medium">請完成安全驗證</p>}
      {ctl.status === 'timeout' && (
        <p role="status" className="mb-2 flex items-start gap-1.5 text-sm text-muted">
          <Info size={16} className="mt-0.5 shrink-0" aria-hidden="true" />安全驗證逾時，請再勾選一次。
        </p>
      )}
      <div
        ref={ctl.hostRef} tabIndex={-1}
        role={interactive ? 'group' : undefined} aria-labelledby={interactive ? labelId : undefined} aria-describedby={needMessage ? needId : undefined}
        className="outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
      />
      {needMessage && (
        <p id={needId} className="mt-1 flex items-start gap-1.5 text-sm text-error-text">
          <CircleAlert size={16} className="mt-0.5 shrink-0" aria-hidden="true" /><span>{needMessage}</span>
        </p>
      )}
      {ctl.status === 'failed' && (
        <Banner kind="error" title="安全驗證沒有通過，請再試一次。" actions={<button type="button" onClick={() => { ctl.retry(); ctl.focus(); }} className={btnOutline}>再試一次</button>} />
      )}
      {ctl.status === 'unavailable' && (
        <Banner kind="error" title={turnstileUnavailableText(inApp, ios)} actions={<button type="button" onClick={() => { ctl.retry(); ctl.focus(); }} className={btnOutline}>重新載入安全驗證</button>} />
      )}
    </div>
  );
}
