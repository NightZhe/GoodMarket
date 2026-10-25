import { useEffect, useRef, useState } from 'react';
import { CircleCheck, X } from 'lucide-react';
import SheetShell from '../SheetShell';
import Banner from '../import/Banner';
import { btnOutline, btnPrimary } from '../import/ui';
import { useToast } from '../Toast';
import { FieldError, Spinner, bigBtn, fieldCls, labelCls, savingBtn } from '../account/ui';
import { useAuth } from '../../store/AuthContext';
import { toAccountError, accountErrorText } from '../../lib/account/errors';
import { CONTACT_EMAIL } from '../../lib/site';
import { useOnline } from '../../lib/useOnline';
import { submitReport } from '../../lib/report/api';
import {
  REPORT_ASSURANCE, REPORT_DETAILS_MAX, REPORT_DONE_BODY, REPORT_DONE_TITLE, REPORT_REASONS, REPORT_TITLE,
  type ReportReason, type ReportTargetType,
} from '../../lib/report/reasons';
import { checkDetails, remainingChars } from '../../lib/report/validate';

export interface ReportTarget {
  type: ReportTargetType;
  id: string;
  /** 副標：商品名／「王*****明 的評價」／店名 */
  subject: string;
}

interface Props {
  target: ReportTarget;
  onClose: () => void;
  /** 店家檢舉成功後多一顆「封鎖這家店」（P2）。呼叫端負責在抽屜關掉後再開確認對話框，兩層不能疊 */
  onBlockShop?: () => void;
}

type Phase = 'form' | 'sending' | 'done' | 'missing';
interface Failure { title: string; body?: string; /** 再試沒有意義：只留「關閉」 */ terminal: boolean }

const NETWORK_TEXT = '連線失敗，請檢查網路後再試一次。';
const CLOSE_BTN = '-mr-2 -mt-1 flex h-11 w-11 shrink-0 items-center justify-center text-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand';

/** 字數播報只在臨界點更新，不每打一字就念（AC-K13） */
function announceFor(prev: number, next: number): string | null {
  if (prev >= 0 && next < 0) return '說明超過 200 字';
  for (const t of [0, 10, 20]) {
    if (prev > t && next <= t && next >= 0) return t === 0 ? '已達 200 字上限' : `還可以輸入 ${next} 字`;
  }
  return null;
}

/**
 * 檢舉抽屜（S-K4～K8）：6 個原因（原生 radio）＋選填說明＋釘底送出列。
 * 錯誤時保留已選原因與說明（狀態都在這裡，不卸載）。未登入的人不會進到這裡（入口先開登入面板）。
 */
export default function ReportSheet({ target, onClose, onBlockShop }: Props) {
  const toast = useToast();
  const online = useOnline();
  const { openLogin } = useAuth();
  const titleRef = useRef<HTMLHeadingElement>(null);
  const errRef = useRef<HTMLDivElement>(null);
  const firstRadioRef = useRef<HTMLInputElement>(null);
  const detailsRef = useRef<HTMLTextAreaElement>(null);
  // 送出途中關掉抽屜：請求照常完成，結果用 toast 補一句；元件已卸載就不能再 setState
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  const [reason, setReason] = useState<ReportReason | null>(null);
  const [details, setDetails] = useState('');
  const [phase, setPhase] = useState<Phase>('form');
  const [reasonMissing, setReasonMissing] = useState(false);
  const [detailsError, setDetailsError] = useState<string | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [announce, setAnnounce] = useState('');
  const lastRemaining = useRef(REPORT_DETAILS_MAX);

  const sending = phase === 'sending';
  const remaining = remainingChars(details);
  const over = remaining < 0;

  // 成功／資料庫未升級：整個抽屜內容換掉，焦點移到新標題（同一個 ref 重新掛上）
  useEffect(() => {
    if (phase === 'done' || phase === 'missing') titleRef.current?.focus();
  }, [phase]);
  useEffect(() => {
    if (failure) errRef.current?.scrollIntoView({ block: 'nearest' });
  }, [failure]);

  const onDetailsChange = (v: string) => {
    setDetails(v);
    setDetailsError(null);
    setFailure(null);
    const next = remainingChars(v);
    const msg = announceFor(lastRemaining.current, next);
    lastRemaining.current = next;
    if (msg) setAnnounce(msg);
  };

  const submit = async () => {
    if (sending) return;
    if (!reason) {
      setReasonMissing(true);
      firstRadioRef.current?.focus();
      return;
    }
    const checked = checkDetails(details);
    if (!checked.ok) {
      setDetailsError(checked.reason === 'too_long' ? `說明最多 ${REPORT_DETAILS_MAX} 字，目前超過 ${checked.over} 字` : '說明含有不能使用的字元');
      detailsRef.current?.focus();
      return;
    }
    // 離線不送：保留已選原因與說明
    if (!online) { setFailure({ title: NETWORK_TEXT, terminal: false }); return; }
    setFailure(null);
    setPhase('sending');
    try {
      await submitReport(target.type, target.id, reason, checked.value);
      if (alive.current) setPhase('done');
      else toast(REPORT_DONE_TITLE);
    } catch (e) {
      const err = toAccountError(e);
      if (!alive.current) {
        if (err.kind === 'auth') openLogin({ expired: true });
        else toast(err.kind === 'network' ? NETWORK_TEXT : accountErrorText(e, '檢舉沒有送出，請再試一次。'), 'error');
        return;
      }
      if (err.kind === 'auth') { onClose(); openLogin({ expired: true }); return; }
      if (err.kind === 'backend_missing') { setPhase('missing'); return; }
      setPhase('form');
      if (err.kind === 'network') { setFailure({ title: NETWORK_TEXT, terminal: false }); return; }
      const message = accountErrorText(e, '檢舉沒有送出，請再試一次。');
      if (err.code === 'REPORT_DETAILS_TOO_LONG' || err.code === 'REPORT_DETAILS_INVALID') { setDetailsError(message); detailsRef.current?.focus(); return; }
      if (err.code === 'REPORT_DAILY_LIMIT') { setFailure({ title: message, body: `如需協助，可以來信 ${CONTACT_EMAIL}。`, terminal: true }); return; }
      if (err.code === 'REPORT_TARGET_NOT_FOUND') { setFailure({ title: message, terminal: true }); return; }
      setFailure({ title: message, terminal: false });
    }
  };

  const heading = (id: string, text: string) => (
    <h2 id={id} ref={titleRef} tabIndex={-1} className="min-w-0 flex-1 pt-px text-lg font-bold outline-none">{text}</h2>
  );
  const closeBtn = (
    <button type="button" onClick={onClose} aria-label="關閉" className={CLOSE_BTN}>
      <X size={22} aria-hidden="true" />
    </button>
  );

  if (phase === 'done') {
    return (
      <SheetShell titleId="report-title" descId="report-desc" titleRef={titleRef} onClose={onClose}>
        <div className="p-4 md:p-6">
          <div className="flex items-start gap-2">
            <CircleCheck size={28} className="mt-0.5 shrink-0 text-success-text" aria-hidden="true" />
            {heading('report-title', REPORT_DONE_TITLE)}
            {closeBtn}
          </div>
          <p id="report-desc" className="mt-2 text-body text-ink">{REPORT_DONE_BODY}</p>
          {target.type === 'shop' && onBlockShop && (
            <button type="button" onClick={() => { onClose(); onBlockShop(); }} className={`${btnOutline} ${bigBtn} mt-6`}>封鎖這家店</button>
          )}
          <button type="button" onClick={onClose} className={`${btnPrimary} ${bigBtn} ${target.type === 'shop' && onBlockShop ? 'mt-3' : 'mt-6'}`}>完成</button>
        </div>
      </SheetShell>
    );
  }

  if (phase === 'missing') {
    return (
      <SheetShell titleId="report-title" descId="report-desc" titleRef={titleRef} onClose={onClose}>
        <div className="p-4 md:p-6">
          <div className="flex items-start gap-2">
            {heading('report-title', REPORT_TITLE[target.type])}
            {closeBtn}
          </div>
          <div id="report-desc" className="mt-4">
            <Banner kind="warning" role="status" title="檢舉功能暫時無法使用">
              你可以來信 <a href={`mailto:${CONTACT_EMAIL}`} className="break-all text-brand underline underline-offset-2">{CONTACT_EMAIL}</a>。
            </Banner>
          </div>
          <button type="button" onClick={onClose} className={`${btnOutline} ${bigBtn} mt-4`}>關閉</button>
        </div>
      </SheetShell>
    );
  }

  return (
    <SheetShell titleId="report-title" descId="report-desc" titleRef={titleRef} onClose={onClose}>
      <form noValidate onSubmit={e => { e.preventDefault(); void submit(); }} aria-label={REPORT_TITLE[target.type]}>
        <div className="p-4 md:p-6">
          <div className="flex items-start gap-2">
            {heading('report-title', REPORT_TITLE[target.type])}
            {closeBtn}
          </div>
          <p id="report-desc" className="mt-1 line-clamp-2 break-words text-sm text-muted">{target.subject}</p>

          <fieldset className="mt-4 min-w-0" aria-describedby={reasonMissing ? 'rr-err' : undefined}>
            <legend className="text-sm font-medium">檢舉原因</legend>
            {reasonMissing && !reason && <FieldError id="rr-err">請選擇原因</FieldError>}
            <div className="-mx-4 mt-2 divide-y divide-line border-y border-line md:-mx-6">
              {REPORT_REASONS.map((r, i) => (
                <label key={r.code} className={`flex min-h-12 items-start gap-3 px-4 py-3 md:px-6 ${reason === r.code ? 'bg-brand-soft' : ''}`}>
                  <input
                    ref={i === 0 ? firstRadioRef : undefined}
                    type="radio" name="report-reason" value={r.code} checked={reason === r.code} disabled={sending}
                    onChange={() => { setReason(r.code); setReasonMissing(false); setFailure(null); }}
                    aria-describedby={`rr-${r.code}`}
                    className="mt-0.5 h-5 w-5 shrink-0 accent-brand"
                  />
                  <span className="min-w-0">
                    <span className="block text-base">{r.label}</span>
                    <span id={`rr-${r.code}`} className="block text-sm text-muted">{r.hint}</span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>

          <label htmlFor="rp-details" className={`${labelCls} mt-4`}>說明<span className="font-normal text-muted">（選填）</span></label>
          <textarea
            id="rp-details" ref={detailsRef} value={details} readOnly={sending}
            onChange={e => onDetailsChange(e.target.value)}
            onBlur={() => setAnnounce(over ? '說明超過 200 字' : `還可以輸入 ${remaining} 字`)}
            placeholder={reason === 'other' ? '請簡單描述問題' : '補充你看到的情況'}
            aria-invalid={over || detailsError !== null || undefined}
            aria-describedby={over || detailsError ? 'rp-err' : undefined}
            className={`${fieldCls(over || detailsError !== null, 'textarea')} mt-2`}
          />
          <div className="mt-1 flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              {over ? <FieldError id="rp-err">{`說明最多 ${REPORT_DETAILS_MAX} 字，目前超過 ${-remaining} 字`}</FieldError>
                : <FieldError id="rp-err">{detailsError ?? undefined}</FieldError>}
            </div>
            {!over && <span aria-hidden="true" className="shrink-0 text-sm tabular-nums text-muted">剩餘 {remaining} 字</span>}
          </div>
          <p role="status" className="sr-only">{announce}</p>

          <p className="mt-4 text-sm text-muted">{REPORT_ASSURANCE}</p>

          {failure && (
            <div ref={errRef} tabIndex={-1} className="mt-4 outline-none">
              <Banner kind="error" title={failure.title}>{failure.body}</Banner>
            </div>
          )}

          <div className="pb-safe sticky bottom-0 -mx-4 mt-4 border-t border-line bg-white md:-mx-6">
            <div className="p-4 md:px-6">
              <p role="status" className="sr-only">{sending ? '正在送出檢舉' : ''}</p>
              {failure?.terminal ? (
                <button type="button" onClick={onClose} className={`${btnOutline} ${bigBtn}`}>關閉</button>
              ) : (
                <button
                  type="submit" aria-disabled={sending || !reason || undefined} aria-busy={sending || undefined}
                  className={`${sending ? savingBtn : reason ? btnPrimary : btnOutline} ${bigBtn}`}
                >
                  {sending && <Spinner />}
                  {sending ? '送出中…' : '送出'}
                </button>
              )}
            </div>
          </div>
        </div>
      </form>
    </SheetShell>
  );
}
