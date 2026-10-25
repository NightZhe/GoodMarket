import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { ChevronDown, Copy, Info, Undo2 } from 'lucide-react';
import Banner from '../import/Banner';
import { btnOutline, focusRing } from '../import/ui';
import { Bone, textActionCls } from '../account/ui';
import { useToast } from '../Toast';
import { useOnline } from '../../lib/useOnline';
import { fetchOrderReturnInfo } from '../../lib/logistics/api';
import { buildReturnInfoView, type ReturnInfoSection, type ReturnInfoView } from '../../lib/logistics/returnInfoView';
import { returnInfoFailure, returnInfoRetryable, type ReturnInfoFailure } from '../../lib/logistics/returnInfoAccess';
import { copyText } from './copyText';

// 買家「我的訂單」每張運送中／已完成訂單的「退貨資訊」收合列與面板（設計 6、spec 8.2）。
// 展開才讀（H-L4）、每次展開都重讀（D10）；不在訂單列表逐張呼叫。

const READ_TIMEOUT_MS = 10_000;
const STALE_MS = 60_000;

export type ReturnInfoLoad =
  | { phase: 'loading' }
  | { phase: 'ready'; view: ReturnInfoView }
  | { phase: 'failed'; failure: ReturnInfoFailure };

const PLAIN_TEXT: Partial<Record<ReturnInfoFailure, string>> = {
  not_available: '這張訂單目前沒有退貨資訊',
  not_found: '找不到這張訂單的退貨資訊',
  auth: '登入已過期，請重新登入。',
};

function SectionView({ section, onCopy }: { section: ReturnInfoSection; onCopy: (s: ReturnInfoSection) => void }) {
  const titleId = useId();
  return (
    <section aria-labelledby={titleId} className="mt-4 first:mt-0">
      <div className="flex items-center justify-between gap-2">
        <h3 id={titleId} className="text-base font-medium">{section.title}</h3>
        <button type="button" aria-label={section.copyLabel} onClick={() => onCopy(section)} className={`${textActionCls} -mr-2 shrink-0 gap-1`}>
          <Copy size={16} aria-hidden="true" />複製
        </button>
      </div>
      <dl className="mt-2 grid gap-x-3 gap-y-1.5 text-sm min-[360px]:grid-cols-[3.25rem_1fr]">
        {section.rows.map(r => (
          <RowView key={r.label} label={r.label} value={r.value} strong={r.strong} />
        ))}
      </dl>
    </section>
  );
}

function RowView({ label, value, strong }: { label: string; value: string; strong: boolean }) {
  return (
    <>
      <dt className="text-muted max-[359px]:mt-1.5 max-[359px]:first:mt-0">{label}</dt>
      <dd className={`min-w-0 select-text break-words ${strong ? 'font-medium' : ''}`}>
        {label === '手機' ? <span className="whitespace-nowrap">{value}</span> : value}
      </dd>
    </>
  );
}

/** 退貨說明：純文字、保留換行、不轉連結（H-L3） */
function NoteView({ note }: { note: string }) {
  const titleId = useId();
  return (
    <section aria-labelledby={titleId} className="mt-4 first:mt-0">
      <h3 id={titleId} className="text-base font-medium">退貨說明</h3>
      <p className="mt-2 select-text whitespace-pre-wrap break-words text-sm leading-6">{note}</p>
    </section>
  );
}

/** 面板內容（純呈現；狀態與讀取在 ReturnInfoToggle） */
export function ReturnInfoPanel({ load, onRetry, onCopy }: {
  load: ReturnInfoLoad;
  onRetry: () => void;
  onCopy: (s: ReturnInfoSection) => void;
}) {
  if (load.phase === 'loading') {
    return (
      <>
        <p role="status" className="sr-only">載入退貨資訊中</p>
        <div className="space-y-3" aria-hidden="true">
          <Bone className="h-5 w-1/3" /><Bone className="h-4 w-full" /><Bone className="h-4 w-4/5" />
        </div>
      </>
    );
  }
  if (load.phase === 'failed') {
    const f = load.failure;
    const retry = returnInfoRetryable(f) ? <button type="button" className={btnOutline} onClick={onRetry}>重試</button> : undefined;
    if (f === 'offline') return <Banner kind="warning" role="status" title="目前沒有網路" actions={retry}>連上網路後才能看到退貨資訊。</Banner>;
    if (f === 'failed') return <Banner kind="error" title="讀不到退貨資訊" actions={retry}>請檢查網路後再試一次。</Banner>;
    if (f === 'unavailable') return <Banner kind="warning" role="status" title="退貨資訊暫時無法使用">請稍後再試。</Banner>;
    return <p role="status" className="text-sm">{PLAIN_TEXT[f]}</p>;
  }
  const v = load.view;
  return (
    <>
      <p role="status" className="sr-only">已載入退貨資訊</p>
      {v.empty ? <p className="text-base font-medium">{v.emptyText}</p> : v.sections.map(s => <SectionView key={s.kind} section={s} onCopy={onCopy} />)}
      {v.note && <NoteView note={v.note} />}
      <p className="mt-4 flex items-start gap-1.5 border-t border-line pt-3 text-sm text-muted">
        <Info size={16} className="mt-0.5 shrink-0 text-info-text" aria-hidden="true" />
        <span>{v.legalText}</span>
      </p>
    </>
  );
}

/**
 * 收合列＋面板。onUnavailable：資料庫還沒升級時通知上層，讓其他訂單的列在這次頁面存活期間不再出現（設計 6.4）。
 */
export default function ReturnInfoToggle({ orderId, orderNo, onUnavailable }: {
  orderId: string;
  orderNo: string;
  onUnavailable?: () => void;
}) {
  const toast = useToast();
  const online = useOnline();
  const [open, setOpen] = useState(false);
  const [load, setLoad] = useState<ReturnInfoLoad>({ phase: 'loading' });
  const seq = useRef(0);
  const lastRead = useRef(0);
  const alive = useRef(true);
  const onUnavailableRef = useRef(onUnavailable);
  onUnavailableRef.current = onUnavailable;
  const panelId = useId();

  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  const read = useCallback(async (silent: boolean) => {
    const mine = ++seq.current;
    if (!silent) {
      // 明確離線：不發請求，直接進離線狀態（設計 6.4）
      if (navigator.onLine === false) { setLoad({ phase: 'failed', failure: 'offline' }); return; }
      setLoad({ phase: 'loading' });
    }
    const timer = silent ? null : setTimeout(() => {
      if (alive.current && seq.current === mine) setLoad({ phase: 'failed', failure: 'failed' });
    }, READ_TIMEOUT_MS);
    try {
      const info = await fetchOrderReturnInfo(orderId);
      if (!alive.current || seq.current !== mine) return;
      lastRead.current = Date.now();
      setLoad({ phase: 'ready', view: buildReturnInfoView(info) });
    } catch (e) {
      // 靜默重讀失敗：保留舊內容，不讓買家抄到一半畫面變空
      if (silent || !alive.current || seq.current !== mine) return;
      const failure = returnInfoFailure(e);
      if (failure === 'unavailable') onUnavailableRef.current?.();
      setLoad({ phase: 'failed', failure });
    } finally {
      if (timer) clearTimeout(timer);
    }
  }, [orderId]);

  const toggle = () => {
    if (open) { seq.current++; setOpen(false); return; }
    setOpen(true);
    void read(false);
  };

  // 展開期間回到前景超過約 60 秒：靜默重讀
  useEffect(() => {
    if (!open) return;
    const onVisible = () => {
      if (document.visibilityState === 'visible' && Date.now() - lastRead.current > STALE_MS) void read(true);
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [open, read]);

  // 離線時展開的面板：連線回來自動重讀
  useEffect(() => {
    if (open && online && load.phase === 'failed' && load.failure === 'offline') void read(false);
  }, [online, open, load, read]);

  const onCopy = async (s: ReturnInfoSection) => {
    if (await copyText(s.copyText)) toast('已複製', 'info');
    else toast('無法自動複製，請長按文字選取後複製', 'error');
  };

  return (
    <div className="border-t border-line px-4">
      <button
        type="button" onClick={toggle} aria-expanded={open} aria-controls={panelId} aria-label={`退貨資訊，訂單 ${orderNo}`}
        className={`flex min-h-12 w-full items-center justify-between gap-2 text-sm ${focusRing}`}
      >
        <span className="flex items-center gap-1.5">
          <Undo2 size={16} className="shrink-0 text-muted" aria-hidden="true" />
          <span className="text-muted">退貨資訊</span>
        </span>
        <ChevronDown size={16} aria-hidden="true" className={`shrink-0 text-muted motion-safe:transition-transform motion-safe:duration-150 motion-safe:ease-out ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="pb-4">
          <div id={panelId} role="region" aria-label="退貨資訊" aria-busy={load.phase === 'loading' || undefined} className="mt-1 rounded-md border border-line bg-subtle p-4">
            <ReturnInfoPanel load={load} onRetry={() => void read(false)} onCopy={s => void onCopy(s)} />
          </div>
        </div>
      )}
    </div>
  );
}
