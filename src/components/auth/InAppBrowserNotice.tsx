import { useEffect, useRef, useState } from 'react';
import { Check, Compass, Copy } from 'lucide-react';
import { routeOfHash } from '../../lib/auth/callback';
import { buildExternalUrl, isIOS, type InAppKind } from '../../lib/auth/inapp';
import { buildPending, type PendingInput } from '../../lib/auth/pending';
import { btnOutline, btnPrimary } from '../import/ui';
import PendingSummary from './PendingSummary';

/** 帶著待辦動作的目前網址：登入面板與賣家中心共用 */
export function currentExternalUrl(kind: InAppKind, trigger: PendingInput | null): string {
  const pending = buildPending(trigger ?? { kind: 'goto' }, routeOfHash(window.location.hash), Date.now());
  return buildExternalUrl(window.location, pending, kind === 'line');
}

const COPY_RESET_MS = 2000;

/** 複製連結：剪貼簿 API 被擋時退回唯讀輸入框，讓使用者自己長按複製 */
function useCopy(url: string) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setState('copied');
      clearTimeout(timer.current);
      // 按鈕文字 2 秒後還原；「已複製」的說明文字保留
      timer.current = setTimeout(() => setState(s => (s === 'copied' ? 'idle' : s)), COPY_RESET_MS);
    } catch {
      setState('failed');
    }
  };
  return { state, copy, copiedBefore: state !== 'failed' && state !== 'idle' };
}

function CopyBlock({ url, primary }: { url: string; primary: boolean }) {
  const { state, copy } = useCopy(url);
  const [everCopied, setEverCopied] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { if (state === 'copied') setEverCopied(true); }, [state]);
  useEffect(() => { if (state === 'failed') inputRef.current?.select(); }, [state]);

  if (state === 'failed') {
    return (
      <div>
        <input
          ref={inputRef} readOnly value={url} aria-label="連結"
          onFocus={e => e.currentTarget.select()}
          className="h-12 w-full rounded-sm border border-line bg-subtle px-3 text-base"
        />
        <p role="alert" className="mt-1.5 text-sm text-error-text">無法自動複製。請長按上面的網址，選「拷貝」。</p>
      </div>
    );
  }
  return (
    <div>
      <button type="button" onClick={() => void copy()} className={`${primary ? btnPrimary : btnOutline} h-12 w-full text-base`}>
        {state === 'copied' ? <Check size={18} className="text-success-text" aria-hidden="true" /> : <Copy size={18} aria-hidden="true" />}
        {state === 'copied' ? '已複製連結' : '複製連結'}
      </button>
      <p role="status" className="mt-1.5 text-sm text-success-text">{everCopied ? '已複製。打開 Safari，貼到網址列就能繼續。' : ''}</p>
    </div>
  );
}

/**
 * S-3：LINE／Facebook／Instagram 內建瀏覽器，Google 不讓登入（disallowed_useragent）。
 * LINE 有官方的外開參數，一鍵用 Safari 開同一頁並帶著待辦動作；FB／IG 沒有，只能請使用者自己換瀏覽器。
 * 標題與說明在容器上（headingFor），這裡只有內容。
 */
export default function InAppBrowserNotice({ kind, trigger }: { kind: InAppKind; trigger: PendingInput | null }) {
  const ios = isIOS(navigator.userAgent);
  const url = currentExternalUrl(kind, trigger);
  const done = trigger?.kind === 'buy_now' ? '登入完成就會直接前往結帳。' : '登入完成就會自動加入購物車。';
  const keeps = trigger && trigger.kind !== 'goto' && trigger.kind !== 'checkout';

  if (kind === 'line') {
    return (
      <div className="space-y-4">
        <PendingSummary trigger={trigger} />
        <div className="flex flex-col gap-2">
          <button type="button" onClick={() => { window.location.href = url; }} className={`${btnPrimary} h-12 w-full text-base`}>
            <Compass size={20} aria-hidden="true" />{ios ? '用 Safari 開啟' : '用瀏覽器開啟'}
          </button>
          {/* 備案：使用者自己的 LINE 設定可能蓋掉外開參數（未查證），外開沒有反應時還有退路 */}
          <CopyBlock url={url} primary={false} />
        </div>
        {keeps && <p className="text-sm text-muted">用 {ios ? 'Safari' : '瀏覽器'} 開啟後，你剛剛的選擇會保留，{done}</p>}
      </div>
    );
  }
  return (
    <div className="space-y-4">
      <PendingSummary trigger={trigger} />
      <ol className="space-y-2 text-sm">
        {['點右上角的「⋯」', '選「在瀏覽器中開啟」'].map((t, i) => (
          <li key={t} className="flex items-center gap-2">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-canvas text-xs font-medium" aria-hidden="true">{i + 1}</span>
            {t}
          </li>
        ))}
      </ol>
      <p className="text-sm text-muted">或是複製連結，貼到 Safari 的網址列</p>
      <CopyBlock url={url} primary />
      {keeps && <p className="text-sm text-muted">你剛剛的選擇會保留，{done}</p>}
    </div>
  );
}
