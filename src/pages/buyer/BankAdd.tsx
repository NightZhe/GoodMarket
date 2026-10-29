import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { ChevronDown, ChevronRight } from 'lucide-react';
import Banner from '../../components/import/Banner';
import LeaveDialog from '../../components/import/LeaveDialog';
import { btnOutline, btnPrimary } from '../../components/import/ui';
import { Bone, FieldError, SubHeader, SubPage, Spinner, fieldCls, helpCls, labelCls, pressCls, savingBtn } from '../../components/account/ui';
import BankLogo from '../../components/payment/BankLogo';
import { useBankFlow } from './BankFlow';
import { useAuth } from '../../store/AuthContext';
import {
  ADD_UNAVAILABLE_TEXT, ERROR_FIELD, STEP_UP_NOTICE_EXPIRED, account2Error, accountError, bankErrorText, firstErrorField, holderError, toAddRequest, validateDraft,
  type BankField, type FieldErrors,
} from '../../lib/payment/bankAccount';
import { BANKS, bankByCode, branchesIn, citiesOf, loadBranchData, type BranchData } from '../../lib/payment/bankData';
import { addBankAccount, errorCodeOf, isAuthError, isBankUnavailable } from '../../lib/payment/api';
import { pageAPath, verifyPath } from '../../lib/payment/bankRoutes';

type Branches = { kind: 'loading' } | { kind: 'error' } | { kind: 'ready'; data: BranchData };
type SubmitError = { title: string; body: string; toList?: boolean; relogin?: boolean } | null;

/** 頁 C「新增銀行帳號」（設計 5）。表單內容只在記憶體（BankFlow 的 draft）；帳號欄不用 password、不擋貼上 */
export default function BankAdd() {
  const flow = useBankFlow();
  const { accounts, phase } = flow;
  const bank = bankByCode(flow.draft.bankCode);

  if (!bank) return <Navigate to={`${flow.base}/new/bank`} replace />;
  if (accounts === null) {
    return (
      <SubPage noTabBar>
        <SubHeader to={pageAPath(flow.origin)} backText="返回" backLabel="返回" title="新增銀行帳號" onBack={e => { e.preventDefault(); flow.leaveToA(); }} />
        {phase === 'error' ? (
          <Banner kind={flow.online ? 'error' : 'warning'} role={flow.online ? 'alert' : 'status'} title={flow.online ? '讀不到你的銀行帳號' : '目前沒有網路'}
            actions={<button type="button" className={btnOutline} onClick={() => void flow.reload()}>重試</button>}>
            {flow.online ? '請檢查網路後再試一次。' : '連上網路後才能新增銀行帳號。'}
          </Banner>
        ) : (
          <div aria-busy="true" role="status"><span className="sr-only">載入中</span><Bone className="mt-3 h-40 w-full" /></div>
        )}
      </SubPage>
    );
  }
  return <AddForm bankName={bank.name} bankCode={bank.code} />;
}

function AddForm({ bankName, bankCode }: { bankName: string; bankCode: string }) {
  const { origin, base, online, draft, setDraft, accounts, setList, leaveToA } = useBankFlow();
  const navigate = useNavigate();
  const { openLogin } = useAuth();
  const uid = useId();
  const [branches, setBranches] = useState<Branches>({ kind: 'loading' });
  const [errors, setErrors] = useState<FieldErrors>({});
  const [submitError, setSubmitError] = useState<SubmitError>(null);
  const [busy, setBusy] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const busyRef = useRef(false);
  const alive = useRef(true);
  const titleRef = useRef<HTMLHeadingElement>(null);

  const count = accounts?.accounts.length ?? 0;
  const limit = accounts?.limit ?? 5;
  const first = count === 0;
  const full = count >= limit;
  const setPayout = first || draft.setPayout;
  const dirty = draft.city !== '' || draft.branchCode !== '' || draft.holder !== '' || draft.account !== '' || draft.account2 !== '' || (!first && draft.setPayout);

  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => { titleRef.current?.focus({ preventScroll: true }); }, []);

  const loadBranches = useCallback(() => {
    setBranches({ kind: 'loading' });
    loadBranchData().then(
      data => { if (alive.current) setBranches({ kind: 'ready', data }); },
      () => { if (alive.current) setBranches({ kind: 'error' }); },
    );
  }, []);
  useEffect(loadBranches, [loadBranches]);

  const cities = useMemo(() => (branches.kind === 'ready' ? citiesOf(branches.data, bankCode) : []), [branches, bankCode]);
  const branchOptions = branches.kind === 'ready' && draft.city ? branchesIn(branches.data, bankCode, draft.city) : [];

  // 換銀行後，原本選的地區這家銀行沒有分行：清掉地區與分行
  useEffect(() => {
    if (branches.kind === 'ready' && draft.city !== '' && !cities.includes(draft.city)) setDraft(d => ({ ...d, city: '', branchCode: '' }));
  }, [branches.kind, cities, draft.city, setDraft]);

  const fieldId = (f: BankField) => `${uid}-${f}`;
  const errId = (f: BankField) => `${uid}-${f}-err`;
  const focusField = (f: BankField) => document.getElementById(fieldId(f))?.focus();
  const clear = (f: BankField) => { setErrors(e => (e[f] ? { ...e, [f]: undefined } : e)); setSubmitError(null); };
  const setErr = (f: BankField, msg: string | undefined) => setErrors(e => ({ ...e, [f]: msg }));

  const describe = (f: BankField, help?: string) => [errors[f] ? errId(f) : null, help ? `${uid}-${f}-help` : null].filter(Boolean).join(' ') || undefined;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busyRef.current) return;
    const errs = validateDraft(draft, BANKS);
    setErrors(errs);
    const bad = firstErrorField(errs);
    if (bad) { setSubmitError(null); focusField(bad); return; }
    if (!online) { setSubmitError({ title: '目前沒有網路', body: '連上網路後再按一次「新增銀行帳號」。你填的內容還在。' }); return; }
    busyRef.current = true;
    setBusy(true);
    setSubmitError(null);
    try {
      const { id, list } = await addBankAccount(toAddRequest({ ...draft, setPayout }));
      setList(list);
      leaveToA({ toast: first ? '已新增，這是你的撥款帳號' : '已新增銀行帳號', focusId: id });
    } catch (err) {
      if (!alive.current) return;
      handleError(err);
    } finally {
      busyRef.current = false;
      if (alive.current) setBusy(false);
    }
  };

  const handleError = (err: unknown) => {
    const code = errorCodeOf(err);
    if (isAuthError(err)) {
      // 登入過期：表單保留，提示重新登入；登入後按同一顆按鈕再送出（AC-45）
      setSubmitError({ title: '登入已過期', body: '請重新登入後，再按一次「新增銀行帳號」。你填的內容還在。', relogin: true });
      openLogin({ expired: true });
      return;
    }
    if (code === 'STEP_UP_REQUIRED' || code === 'PHONE_REQUIRED') {
      navigate(verifyPath(origin, 'add'), { replace: true, state: { notice: STEP_UP_NOTICE_EXPIRED } });
      return;
    }
    if (code === 'BANK_ACCOUNT_LIMIT') { setSubmitError({ title: '最多 5 個銀行帳號，請先刪除不用的', body: '', toList: true }); return; }
    const field = code ? ERROR_FIELD[code] : undefined;
    if (field) {
      setErr(field, bankErrorText(code, ''));
      focusField(field);
      return;
    }
    if (isBankUnavailable(err)) { setSubmitError({ title: '新增失敗', body: ADD_UNAVAILABLE_TEXT }); return; }
    const known = bankErrorText(code, '');
    setSubmitError({ title: '新增失敗', body: known ? `${known}你填的內容還在。` : '請檢查網路後再試一次。你填的內容還在。' });
  };

  const back = (ev: React.MouseEvent) => { ev.preventDefault(); if (dirty && !busy) setLeaving(true); else leaveToA(); };

  const ro = busy || undefined;
  const bankChangePath = `${base}/new/bank`;

  return (
    <SubPage noTabBar>
      <SubHeader to={pageAPath(origin)} backText="返回" backLabel="返回" title="新增銀行帳號" onBack={back} />
      <h2 ref={titleRef} tabIndex={-1} className="sr-only outline-none">填寫銀行帳號資料</h2>

      <div className="mt-3">
        <Banner kind="info" role="none" title="須為你本人或公司名下的帳戶，否則撥款會失敗。">
          {!first && draft.setPayout && '設為撥款帳號後，下一次撥款就會匯到這個帳號；它還沒驗證過，要等第一次撥款成功才算通過。'}
        </Banner>
      </div>

      <form onSubmit={e => void submit(e)} noValidate className="mt-3">
        <div className="rounded-card bg-white p-4">
          <button
            id={fieldId('bank')} type="button" onClick={() => navigate(bankChangePath, { state: { change: true } })} aria-label={`銀行：${bankName}，更改`}
            className={`-m-1 mb-3 flex min-h-14 w-[calc(100%+0.5rem)] items-center gap-3 rounded-sm p-1 text-left ${pressCls}`}
          >
            <BankLogo code={bankCode} size={40} />
            <span aria-hidden="true" className="min-w-0 flex-1 text-headline font-semibold [overflow-wrap:anywhere]">{bankName}</span>
            <span aria-hidden="true" className="flex shrink-0 items-center text-subhead text-muted">更改<ChevronRight size={18} /></span>
          </button>

          {branches.kind === 'error' && (
            <div className="mb-3">
              <Banner kind="error" title="分行清單載入失敗" actions={<button type="button" className={btnOutline} onClick={loadBranches}>重試</button>}>請檢查網路後再試一次。</Banner>
            </div>
          )}

          <Select
            id={fieldId('city')} label="地區" value={draft.city} placeholder={branches.kind === 'loading' ? '載入中…' : '選擇縣市'}
            disabled={branches.kind !== 'ready' || busy} error={errors.city} errId={errId('city')} describedBy={describe('city')}
            options={cities.map(c => ({ value: c, label: c }))}
            onChange={v => { setDraft(d => ({ ...d, city: v, branchCode: '' })); clear('city'); clear('branch'); }}
          />
          <div className="mt-4">
            <Select
              id={fieldId('branch')} label="分行" value={draft.branchCode} placeholder={draft.city ? '選擇分行' : '請先選擇地區'}
              disabled={!draft.city || branches.kind !== 'ready' || busy} error={errors.branch} errId={errId('branch')} describedBy={describe('branch')}
              options={branchOptions.map(b => ({ value: b.code, label: b.name }))}
              onChange={v => { setDraft(d => ({ ...d, branchCode: v })); clear('branch'); }}
            />
          </div>

          <div className="mt-4">
            <label htmlFor={fieldId('holder')} className={labelCls}>戶名</label>
            <input
              id={fieldId('holder')} type="text" value={draft.holder} readOnly={ro} maxLength={60} autoComplete="off" autoCapitalize="words" enterKeyHint="next"
              aria-invalid={errors.holder ? true : undefined} aria-describedby={describe('holder', 'help')}
              onChange={e => { setDraft(d => ({ ...d, holder: e.target.value })); clear('holder'); }}
              onBlur={() => { if (draft.holder !== '') setErr('holder', holderError(draft.holder)); }}
              className={`${fieldCls(Boolean(errors.holder))} mt-1`}
            />
            <p id={`${uid}-holder-help`} className={helpCls}>要與銀行登記的戶名一致</p>
            <FieldError id={errId('holder')}>{errors.holder}</FieldError>
          </div>

          <div className="mt-4">
            <label htmlFor={fieldId('account')} className={labelCls}>帳號</label>
            <input
              id={fieldId('account')} type="text" inputMode="numeric" pattern="[0-9]*" value={draft.account} readOnly={ro} maxLength={20}
              autoComplete="off" autoCorrect="off" spellCheck={false} enterKeyHint="next" data-1p-ignore data-lpignore="true"
              aria-invalid={errors.account ? true : undefined} aria-describedby={describe('account', 'help')}
              onChange={e => { setDraft(d => ({ ...d, account: e.target.value })); clear('account'); }}
              onBlur={() => { if (draft.account !== '') setErr('account', accountError(draft.account)); }}
              className={`${fieldCls(Boolean(errors.account))} mt-1 tabular-nums`}
            />
            <p id={`${uid}-account-help`} className={helpCls}>只輸入數字，不用加「-」</p>
            <FieldError id={errId('account')}>{errors.account}</FieldError>
          </div>

          <div className="mt-4">
            <label htmlFor={fieldId('account2')} className={labelCls}>再輸入一次帳號</label>
            <input
              id={fieldId('account2')} type="text" inputMode="numeric" pattern="[0-9]*" value={draft.account2} readOnly={ro} maxLength={20}
              autoComplete="off" autoCorrect="off" spellCheck={false} enterKeyHint="done" data-1p-ignore data-lpignore="true"
              aria-invalid={errors.account2 ? true : undefined} aria-describedby={describe('account2')}
              onChange={e => { setDraft(d => ({ ...d, account2: e.target.value })); clear('account2'); }}
              onBlur={() => { if (draft.account2 !== '' && !accountError(draft.account)) setErr('account2', account2Error(draft.account, draft.account2)); }}
              className={`${fieldCls(Boolean(errors.account2))} mt-1 tabular-nums`}
            />
            <FieldError id={errId('account2')}>{errors.account2}</FieldError>
          </div>
        </div>

        <div className="mt-2 rounded-card bg-white px-4">
          <button
            type="button" role="switch" aria-checked={setPayout} aria-disabled={first || busy || undefined}
            aria-describedby={`${uid}-payout-help`}
            onClick={() => { if (!first && !busy) setDraft(d => ({ ...d, setPayout: !d.setPayout })); }}
            className="flex min-h-12 w-full items-center justify-between gap-3 py-2 text-left"
          >
            <span className="text-body">設為撥款帳號</span>
            <span aria-hidden="true" className={`relative inline-flex h-[31px] w-[51px] shrink-0 items-center rounded-full ${setPayout ? 'bg-brand' : 'bg-disabled'}`}>
              <span className={`absolute size-[27px] rounded-full bg-white transition-transform duration-150 motion-reduce:transition-none ${setPayout ? 'translate-x-[22px]' : 'translate-x-0.5'}`} />
            </span>
          </button>
        </div>
        <p id={`${uid}-payout-help`} className="px-5 pt-2 text-footnote text-muted text-pretty">
          {first ? '第一個銀行帳號會自動成為撥款帳號。' : setPayout ? '' : '之後可以在列表把它設為撥款帳號。'}
        </p>

        {full && (
          <div className="mt-4"><Banner kind="error" title="最多 5 個銀行帳號，請先刪除不用的" actions={<button type="button" className={btnOutline} onClick={() => leaveToA()}>回到列表</button>} /></div>
        )}
        {submitError && (
          <div className="mt-4">
            <Banner kind="error" title={submitError.title} actions={
              submitError.toList ? <button type="button" className={btnOutline} onClick={() => leaveToA()}>回到列表</button>
                : submitError.relogin ? <button type="button" className={btnOutline} onClick={() => openLogin({ expired: true })}>重新登入</button> : undefined
            }>
              {submitError.body}
            </Banner>
          </div>
        )}
        {!online && <p role="status" className="mt-3 text-sm text-muted">目前沒有網路，連上網路後才能新增。</p>}

        <button
          type="submit" aria-disabled={busy || full || undefined} aria-busy={busy || undefined}
          className={`mt-4 h-12 w-full text-base ${busy ? savingBtn : `${full ? btnOutline : btnPrimary} ${full ? 'text-muted' : ''}`} ${pressCls}`}
        >
          {busy ? <><Spinner />新增中…</> : '新增銀行帳號'}
        </button>
      </form>

      {leaving && (
        <LeaveDialog
          title="不新增這個銀行帳號了？" description="已填的內容不會保存。" stayLabel="繼續填寫" leaveLabel="放棄"
          onStay={() => setLeaving(false)} onLeave={() => { setLeaving(false); leaveToA(); }}
        />
      )}
    </SubPage>
  );
}

function Select({ id, label, value, placeholder, disabled, error, errId, describedBy, options, onChange }: {
  id: string; label: string; value: string; placeholder: string; disabled: boolean; error?: string; errId: string; describedBy?: string;
  options: { value: string; label: string }[]; onChange: (v: string) => void;
}) {
  return (
    <div>
      <label htmlFor={id} className={labelCls}>{label}</label>
      <div className="relative mt-1">
        <select
          id={id} value={value} disabled={disabled} onChange={e => onChange(e.target.value)}
          aria-invalid={error ? true : undefined} aria-describedby={describedBy}
          className={fieldCls(Boolean(error), 'select', value === '')}
        >
          <option value="">{placeholder}</option>
          {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <ChevronDown size={18} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-muted" aria-hidden="true" />
      </div>
      <FieldError id={errId}>{error}</FieldError>
    </div>
  );
}
