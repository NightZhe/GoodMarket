import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { CircleAlert, CircleCheck, CircleDashed, Clock } from 'lucide-react';
import { useStore } from '../../store/StoreContext';
import Banner from '../import/Banner';
import { btnOutline, btnPrimary } from '../import/ui';
import { FieldError, SubHeader, SubPage, Bone, Spinner, fieldCls, helpCls, labelCls, pressCls } from '../account/ui';
import { errorCodeOf, fetchMyMerchant, isAuthError, submitMerchantId } from '../../lib/payment/api';
import { MERCHANT_STATE_TEXT, isValidMerchantId, merchantErrorText, merchantStateOf, type MerchantState } from '../../lib/payment/merchant';
import type { SellerEcpayMerchantRow } from '../../lib/payment/types';
import { useOnline } from '../../lib/useOnline';
import { useRefreshOnVisible } from '../../store/ReviewsContext';
import { accountErrorText } from '../../lib/account/errors';

/** 綠界「開店說明」頁（賣家成為本站平台商底下特約商店的入口）。綠界還沒給網址（U-P1），沒設定就不顯示那顆按鈕 */
const ONBOARD_URL = (import.meta.env.VITE_ECPAY_ONBOARD_URL as string | undefined) || '';

const ICON: Record<MerchantState, { Icon: typeof CircleDashed; tone: string }> = {
  none: { Icon: CircleDashed, tone: 'bg-canvas text-muted' },
  review: { Icon: Clock, tone: 'bg-info-bg text-info-text' },
  active: { Icon: CircleCheck, tone: 'bg-success-soft text-success-text' },
  rejected: { Icon: CircleAlert, tone: 'bg-error-bg text-error-text' },
  suspended: { Icon: CircleAlert, tone: 'bg-error-bg text-error-text' },
};

type Load = { kind: 'loading' } | { kind: 'error' } | { kind: 'ready'; row: SellerEcpayMerchantRow | null };

const tsText = (iso: string) => {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

/**
 * 收款帳戶：帳號頁（#/account/payout）與賣家中心（#/seller/payout）共用同一頁，只有返回連結不同（設計 11）。
 * backText＝返回鈕看得到的字，沒傳就是 SubHeader 的預設「我的」；backLabel 要包含它（WCAG 2.5.3）
 */
export default function PayoutAccountPage({ backTo, backLabel, backText }: { backTo: string; backLabel: string; backText?: string }) {
  const { myShop, shopReady } = useStore();
  const online = useOnline();
  const [load, setLoad] = useState<Load>({ kind: 'loading' });
  const [refreshing, setRefreshing] = useState(false);
  const seq = useRef(0);

  const reload = useCallback(async (silent = false) => {
    const mine = ++seq.current;
    if (!silent) setLoad(l => (l.kind === 'ready' ? l : { kind: 'loading' }));
    try {
      const row = await fetchMyMerchant();
      if (mine === seq.current) setLoad({ kind: 'ready', row });
    } catch {
      // 讀不到就是讀不到：不顯示任何狀態，更不猜。離線時保留上次讀到的（唯讀）
      if (mine === seq.current && !silent) setLoad(l => (l.kind === 'ready' ? l : { kind: 'error' }));
    }
  }, []);

  useEffect(() => { if (myShop) void reload(); }, [myShop, reload]);
  // 賣家從綠界回來的主要路徑：回前景、iOS 返回鍵還原整頁快照時重讀
  useRefreshOnVisible(() => { if (myShop) void reload(true); });
  useEffect(() => {
    const onShow = (e: PageTransitionEvent) => { if (e.persisted && myShop) void reload(true); };
    window.addEventListener('pageshow', onShow);
    return () => window.removeEventListener('pageshow', onShow);
  }, [myShop, reload]);

  const header = <SubHeader to={backTo} backLabel={backLabel} backText={backText} title="收款帳戶" />;

  if (!shopReady) return <SubPage>{header}<div aria-busy="true" role="status" className="mt-2 bg-white p-6 rounded-card"><span className="sr-only">載入中</span><Bone className="h-12 w-12" /></div></SubPage>;

  if (!myShop) {
    return (
      <SubPage>
        {header}
        <div className="mt-2 bg-white p-4 md:mt-3 rounded-card md:p-6">
          <Banner kind="info" role="status" title="你還沒有開店" actions={<Link to="/seller" className={btnOutline}>前往賣家中心</Link>}>
            開店之後，才需要開通收款。
          </Banner>
        </div>
      </SubPage>
    );
  }

  return (
    <SubPage>
      {header}
      {load.kind === 'loading' && (
        <div aria-busy="true" className="mt-2 bg-white p-4 md:mt-3 rounded-card md:p-6">
          <p role="status" className="sr-only">載入中</p>
          <div className="flex gap-3"><Bone className="h-12 w-12 !rounded-full" /><div className="flex-1 space-y-2 pt-1"><Bone className="h-3 w-24" /><Bone className="h-5 w-32" /><Bone className="h-3 w-full" /></div></div>
        </div>
      )}
      {load.kind === 'error' && (
        <div className="mt-2 bg-white p-4 md:mt-3 rounded-card md:p-6">
          <Banner kind="error" title="讀不到收款狀態" actions={<button type="button" className={btnOutline} onClick={() => void reload()}>重試</button>}>請檢查網路後再試一次。</Banner>
        </div>
      )}
      {load.kind === 'ready' && (
        <>
          {!online && (
            <div className="mt-2 md:mt-3">
              <Banner kind="warning" role="status" title="目前沒有網路">顯示的是上次讀到的狀態，可能不是最新的。連上網路後會自動更新。</Banner>
            </div>
          )}
          <StatusBlock
            row={load.row} online={online} refreshing={refreshing}
            onRefresh={() => { setRefreshing(true); void reload(true).finally(() => setRefreshing(false)); }}
            onSubmitted={() => reload(true)}
          />
        </>
      )}
    </SubPage>
  );
}

function StatusBlock({ row, online, refreshing, onRefresh, onSubmitted }: {
  row: SellerEcpayMerchantRow | null; online: boolean; refreshing: boolean; onRefresh: () => void; onSubmitted: () => Promise<void>;
}) {
  const state = merchantStateOf(row);
  const { title, lead } = MERCHANT_STATE_TEXT[state];
  const { Icon, tone } = ICON[state];
  const needsInput = state === 'none' || state === 'rejected' || state === 'suspended';

  return (
    <>
      <section className="mt-2 bg-white p-4 md:mt-3 rounded-card md:p-6">
        <div className="flex items-start gap-3">
          <span className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-full ${tone}`} aria-hidden="true"><Icon size={24} /></span>
          <div className="min-w-0 flex-1">
            <p className="text-sm text-muted">線上收款狀態</p>
            <h2 className="text-xl font-bold">{title}</h2>
            <p className="mt-1 text-sm leading-6 text-pretty">{lead}</p>
          </div>
        </div>

        {(state === 'rejected' || state === 'suspended') && (
          <div className="mt-3 rounded-md border border-error-border bg-error-bg p-3">
            <p className="text-sm font-medium">退回原因</p>
            <p className="mt-1 break-words text-sm leading-6">{row?.reason || '沒有提供原因。'}</p>
          </div>
        )}

        {state === 'active' && row && (
          <dl className="mt-3 divide-y divide-line rounded-md border border-line text-sm">
            <div className="flex flex-wrap justify-between gap-x-3 px-3 py-2"><dt className="text-muted">特約商店編號</dt><dd className="tabular-nums">{row.ecpay_merchant_id}</dd></div>
            <div className="flex flex-wrap justify-between gap-x-3 px-3 py-2"><dt className="text-muted">收款銀行帳戶</dt><dd>已在綠界科技設定</dd></div>
          </dl>
        )}

        <div className="mt-4 flex flex-col gap-2">
          {state === 'review' && (
            <button type="button" className={`${btnOutline} h-12 w-full text-base ${pressCls}`} aria-disabled={refreshing || undefined} onClick={() => { if (!refreshing) onRefresh(); }}>
              {refreshing ? <><Spinner />更新中…</> : '重新整理狀態'}
            </button>
          )}
          {state === 'review' && <p className={helpCls}>審核結果以綠界科技的通知為準，出來後這裡會更新。</p>}
          {ONBOARD_URL && needsInput && (
            <>
              <a href={ONBOARD_URL} className={`${btnPrimary} h-12 w-full text-base ${pressCls}`}>{state === 'none' ? '前往綠界開通' : '前往綠界修正資料'}</a>
              <p className={helpCls}>會離開好物集。完成後請回到這裡，狀態會自動更新。</p>
            </>
          )}
          {state === 'active' && ONBOARD_URL && (
            <a href={ONBOARD_URL} className={`${btnOutline} h-12 w-full text-base ${pressCls}`}>前往綠界管理收款帳戶</a>
          )}
        </div>
        {row && <p className="mt-3 text-sm text-muted">狀態更新於 {tsText(row.updated_at)}</p>}
      </section>

      {needsInput && <MerchantForm online={online} defaultValue={row?.ecpay_merchant_id ?? ''} onSubmitted={onSubmitted} />}

      {needsInput && (
        <Card title="怎麼開通">
          <ol className="list-decimal space-y-1.5 pl-5 text-sm leading-6">
            <li>前往綠界科技，註冊會員並成為好物集底下的特約商店。</li>
            <li>在綠界科技依要求上傳證件、綁定你自己的銀行帳戶。</li>
            <li>拿到特約商店編號後，填在上面並送出審核。審核通過後，狀態會變成「可收款」。</li>
          </ol>
          <p className="mt-3 text-sm text-muted">證件與銀行帳戶資料只提供給綠界科技，好物集不會收到，也不會儲存完整銀行帳號。</p>
        </Card>
      )}

      {state !== 'active' && (
        <Card title="沒開通會怎樣">
          <ul className="list-disc space-y-1.5 pl-5 text-sm leading-6">
            <li>買家看到你的商品時，結帳只能選貨到付款。</li>
            <li>買家同時買你和其他店的商品時，你的商店會排在「貨到付款」那一段，其他店照常線上付款。</li>
          </ul>
        </Card>
      )}

      {state === 'active' && (
        <Card title="撥款">
          <p className="text-sm leading-6">撥款時程與提領方式以綠界科技為準。每筆線上付款訂單的撥款狀態，在「訂單管理」查看。</p>
          <Link to="/seller/orders" className="-mb-2 mt-1 inline-flex min-h-11 items-center text-sm text-ink underline underline-offset-2">前往訂單管理</Link>
        </Card>
      )}
    </>
  );
}

function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-2 bg-white p-4 md:mt-3 rounded-card md:p-6">
      <h2 className="mb-2 text-sm font-bold">{title}</h2>
      {children}
    </section>
  );
}

function MerchantForm({ online, defaultValue, onSubmitted }: { online: boolean; defaultValue: string; onSubmitted: () => Promise<void> }) {
  const [value, setValue] = useState(defaultValue);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy || !online) return;
    const v = value.trim();
    if (!isValidMerchantId(v)) { setError('特約商店編號要是 7 到 10 位數字。'); inputRef.current?.focus(); return; }
    setError('');
    setBusy(true);
    try {
      await submitMerchantId(v);
      setSent(true);
      await onSubmitted();
    } catch (err) {
      if (isAuthError(err)) setError('登入已過期，請重新登入後再送出。');
      else setError(merchantErrorText(errorCodeOf(err), accountErrorText(err, '送出失敗，請檢查網路後再試一次。')));
      inputRef.current?.focus();
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="mt-2 bg-white p-4 md:mt-3 rounded-card md:p-6">
      <h2 className="mb-2 text-sm font-bold">填入綠界特約商店編號</h2>
      <form onSubmit={e => void submit(e)} noValidate>
        <label htmlFor="merchant-id" className={labelCls}>特約商店編號</label>
        <input
          id="merchant-id" ref={inputRef} value={value} inputMode="numeric" autoComplete="off" maxLength={10}
          aria-invalid={error ? true : undefined} aria-describedby={error ? 'merchant-err merchant-help' : 'merchant-help'}
          onChange={ev => { setValue(ev.target.value.replace(/\D/g, '')); setError(''); setSent(false); }}
          className={`${fieldCls(Boolean(error))} mt-1 tabular-nums`}
        />
        <p id="merchant-help" className={helpCls}>7 到 10 位數字，在綠界科技開店完成後取得。送出後由好物集核對，通過才會開通。</p>
        <FieldError id="merchant-err">{error}</FieldError>
        {sent && !error && <p role="status" className="mt-2 text-sm text-success-text">已送出審核。</p>}
        {!online && <p role="status" className="mt-2 text-sm text-muted">目前沒有網路，連上網路後才能送出。</p>}
        <button type="submit" aria-disabled={busy || !online || undefined} aria-busy={busy || undefined} className={`${btnPrimary} mt-4 h-12 w-full text-base ${pressCls} ${busy ? 'cursor-wait' : ''}`}>
          {busy ? <><Spinner />送出中…</> : '送出審核'}
        </button>
      </form>
    </section>
  );
}

