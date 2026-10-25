import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { Ban, CircleAlert, CircleCheck, CreditCard, Hourglass, LoaderCircle, SearchX, UserRound } from 'lucide-react';
import { useStore } from '../../store/StoreContext';
import { useAuth } from '../../store/AuthContext';
import Banner from '../../components/import/Banner';
import LeaveDialog from '../../components/import/LeaveDialog';
import { btnOutline, btnPrimary } from '../../components/import/ui';
import { useToast } from '../../components/Toast';
import { pressCls, textActionCls } from '../../components/account/ui';
import BindSheet from '../../components/payment/BindSheet';
import CardRadioList from '../../components/payment/CardRadioList';
import { PayTag, type PayTagKind } from '../../components/payment/PayTag';
import ResultCard from '../../components/payment/ResultCard';
import { BIND_RETURN_PATH } from './PaymentMethodNew';
import { cancelAccountOrder } from '../../lib/account/api';
import { money } from '../../lib/format';
import {
  errorCodeOf, expireMyPendingOrders, fetchOrderPayments, fetchPaymentStatus, isAuthError, payErrorText, payGroup,
} from '../../lib/payment/api';
import { brandLabel } from '../../lib/payment/cards';
import { clockText, msUntil } from '../../lib/payment/countdown';
import { failedCardIdOf, recallPayCard, rememberPayCard } from '../../lib/payment/lastCard';
import { browserStores } from '../../lib/auth/pending';
import { preselectRetryCard, type PayChoice } from '../../lib/payment/plan';
import {
  CONFIRM_POLL, SLOW_PAY_MS, WAIT_PAY_MS, destinationOfPayError, failureSentences, pollAction, screenOfGroup, type PayScreen,
} from '../../lib/payment/screens';
import type { OrderPaymentRow, PaymentGroupView, PaymentErrorCode } from '../../lib/payment/types';
import { useCards } from '../../lib/payment/useCards';
import { useOnline } from '../../lib/useOnline';

const btnMain = `${btnPrimary} ${pressCls} h-12 w-full text-base`;
const btnSub = `${btnOutline} ${pressCls} h-12 w-full text-base`;
const CARDS_TIMEOUT_MS = 10_000;

interface PayState { cod?: { shopId: string; total: number; orderNo: string }[]; notice?: string }

type Load = { kind: 'loading' } | { kind: 'error' } | { kind: 'notfound' } | { kind: 'ready'; group: PaymentGroupView };

/** 付款結果／重新付款 #/pay/:paymentId（S-6）。畫哪一種完全由伺服器的付款群組狀態決定，網址參數不採信 */
export default function PayResult() {
  const { paymentId = '' } = useParams();
  const { user, authReady } = useStore();
  const { openLogin } = useAuth();

  if (!authReady) return <div role="status" className="p-12 text-center text-sm text-muted">載入中…</div>;
  if (!user) {
    return (
      <ResultCard
        focusKey="unauth" icon={<UserRound size={48} strokeWidth={1.5} className="text-muted" />} title="請登入後查看付款結果"
        actions={<button type="button" className={btnMain} onClick={() => openLogin({ trigger: { kind: 'goto' } })}>登入</button>}
      >
        沒有登入時，不會顯示訂單與卡片資料。登入後，也可以到「我的訂單」查看。
      </ResultCard>
    );
  }
  return <PayView groupId={paymentId} />;
}

function PayView({ groupId }: { groupId: string }) {
  const { getShop, refreshMyOrders } = useStore();
  const { openLogin } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const online = useOnline();
  const { state } = useLocation() as { state: PayState | null };
  const [load, setLoad] = useState<Load>({ kind: 'loading' });
  const [payments, setPayments] = useState<OrderPaymentRow[]>([]);
  const [notice, setNotice] = useState(state?.notice ?? '');
  const [paying, setPaying] = useState(false);
  const [slow, setSlow] = useState(false);
  const [choice, setChoice] = useState<PayChoice | null>(null);
  const [pickError, setPickError] = useState(false);
  const [bindOpen, setBindOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelBusy, setCancelBusy] = useState(false);
  const [pollStopped, setPollStopped] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const seq = useRef(0);
  const listRef = useRef<HTMLDivElement>(null);

  const group = load.kind === 'ready' ? load.group : null;
  const screen: PayScreen | null = group ? screenOfGroup(group) : null;
  const needCards = screen === 'pay' || screen === 'failed';
  const cardsHook = useCards({ timeoutMs: CARDS_TIMEOUT_MS, paused: !needCards });
  const cards = useMemo(() => cardsHook.rows ?? [], [cardsHook.rows]);

  const reload = useCallback(async (silent = false) => {
    const mine = ++seq.current;
    if (!silent) setLoad(l => (l.kind === 'ready' ? l : { kind: 'loading' }));
    try {
      const g = await fetchPaymentStatus(groupId);
      if (mine !== seq.current) return;
      setLoad({ kind: 'ready', group: g });
      if (g.status === 'paid') fetchOrderPayments().then(rows => { if (mine === seq.current) setPayments(rows.filter(r => r.group_id === groupId)); }, () => undefined);
    } catch (e) {
      if (mine !== seq.current) return;
      const code = errorCodeOf(e);
      if (code === 'GROUP_NOT_FOUND') setLoad({ kind: 'notfound' });
      else if (isAuthError(e)) openLogin({ expired: true, trigger: { kind: 'goto' } });
      else if (!silent) setLoad(l => (l.kind === 'ready' ? l : { kind: 'error' }));
    }
  }, [groupId, openLogin]);

  // 進頁、回前景、iOS 返回鍵還原整頁快照（從綠界、銀行、LINE 回來的主要入口）都重查
  useEffect(() => {
    void reload();
    const onVisible = () => { if (document.visibilityState === 'visible') void reload(true); };
    const onShow = (e: PageTransitionEvent) => { if (e.persisted) void reload(true); };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('pageshow', onShow);
    return () => { document.removeEventListener('visibilitychange', onVisible); window.removeEventListener('pageshow', onShow); };
  }, [reload]);

  // 確認中：每 3 秒靜默重查，最多 3 分鐘，之後停下來給「重新整理結果」。狀態改變時 role=status 念一次
  const confirmingSince = useRef<number | null>(null);
  useEffect(() => {
    if (screen !== 'confirming') { confirmingSince.current = null; setPollStopped(false); return; }
    confirmingSince.current ??= Date.now();
    const act = pollAction('confirming', Date.now() - confirmingSince.current);
    if (!act.poll) { setPollStopped(true); return; }
    const t = setTimeout(() => void reload(true), act.delayMs);
    return () => clearTimeout(t);
  }, [screen, load, reload]);

  // 待付款逾時：時間到時作廢自己逾時的單、退庫存，然後重讀
  const expiresAt = group?.expiresAt;
  useEffect(() => {
    if (!needCards || !expiresAt || paying) return;
    const t = setTimeout(() => { void expireMyPendingOrders().catch(() => undefined).finally(() => { void reload(true); void refreshMyOrders(true); }); }, msUntil(expiresAt, Date.now()) + 500);
    return () => clearTimeout(t);
  }, [needCards, expiresAt, paying, reload, refreshMyOrders]);

  // 重付區的預選：預設且未過期且不是剛失敗的那張 → 第一張可用的 → 都沒有就不預選。
  // 後端沒回「用的是哪張卡」，所以用這個瀏覽器分頁按付款時記下的（lib/payment/lastCard.ts）；換瀏覽器就退回預設規則
  const [store] = browserStores();
  const failedCardId = group && screen === 'failed' ? failedCardIdOf(group.lastFail, store ? recallPayCard(store, groupId) : null) : null;
  const failKey = screen === 'failed' ? group?.lastFail?.attemptNo ?? 0 : 0;
  const handledFail = useRef(0);
  useEffect(() => {
    if (!needCards || cardsHook.rows === null) return;
    // 剛又失敗一次：先前選的就是剛失敗的那張，要換掉；使用者之後自己再選回那張則不再干預（failKey 沒變）
    const stale = failKey !== handledFail.current && failedCardId !== null && choice?.kind === 'card' && choice.cardId === failedCardId;
    handledFail.current = failKey;
    if (!stale && choice?.kind === 'card' && cards.some(c => c.id === choice.cardId)) return;
    const id = preselectRetryCard(cards, failedCardId);
    setChoice(id ? { kind: 'card', cardId: id } : null);
  }, [needCards, cardsHook.rows, cards, choice, failKey, failedCardId]);

  const nameOf = (shopId: string) => getShop(shopId)?.name ?? '這家店';

  const pay = async () => {
    if (!group || paying || !online) return;
    if (choice?.kind !== 'card') { setPickError(true); listRef.current?.querySelector('input')?.focus(); return; }
    setPickError(false);
    setNotice('');
    setPaying(true);
    if (store) rememberPayCard(store, group.groupId, choice.cardId);
    const slowTimer = setTimeout(() => setSlow(true), SLOW_PAY_MS);
    try {
      const res = await Promise.race([payGroup(group.groupId, choice.cardId), new Promise<'wait'>(r => setTimeout(() => r('wait'), WAIT_PAY_MS))]);
      if (res === 'wait') await reload(true);
      else setLoad({ kind: 'ready', group: res.group });
      if (res !== 'wait' && res.outcome === 'paid') void reload(true);
    } catch (e) {
      const code = errorCodeOf(e);
      if (isAuthError(e)) openLogin({ expired: true, trigger: { kind: 'goto' } });
      else if (code && destinationOfPayError(code as PaymentErrorCode)) await reload(true);
      else { setNotice(payErrorText(e, '付款沒有完成，請再試一次。')); void reload(true); }
    } finally {
      clearTimeout(slowTimer);
      setSlow(false);
      setPaying(false);
    }
  };

  const cancelAll = async () => {
    if (!group || cancelBusy) return;
    setCancelBusy(true);
    try {
      for (const o of group.orders) await cancelAccountOrder(o.orderId); // 一起付款的單只能一起取消，逐張取消
      void refreshMyOrders(true);
      toast('已取消訂單');
      navigate('/orders', { replace: true });
    } catch (e) {
      const code = errorCodeOf(e);
      toast(code === 'ORDER_PAID_NO_CANCEL' ? '這筆訂單已經付款，目前無法自行取消。' : code === 'PAYMENT_IN_PROGRESS' ? '付款正在處理中，暫時無法取消。' : '取消失敗，請檢查網路後再試', 'error');
      void reload(true);
      void refreshMyOrders(true);
    } finally {
      setCancelOpen(false);
      setCancelBusy(false);
    }
  };

  if (load.kind === 'loading') {
    return (
      <div role="status" className="mx-auto max-w-lg p-3 md:py-12">
        <div className="rounded-md bg-white px-5 py-12 text-center">
          <LoaderCircle size={32} className="mx-auto text-muted motion-safe:animate-spin" aria-hidden="true" />
          <p className="mt-4 font-medium">正在確認付款結果…</p>
          <p className="mt-1 text-sm text-muted">請不要關閉這一頁。</p>
        </div>
      </div>
    );
  }

  if (load.kind === 'error') {
    return (
      <div className="mx-auto max-w-lg p-3 md:py-12">
        <div className="rounded-md bg-white p-4 md:p-6">
          <Banner
            kind="error" title="讀不到付款結果"
            actions={<><button type="button" className={btnOutline} onClick={() => void reload()}>重試</button><Link to="/orders" className={btnOutline}>查看訂單</Link></>}
          >
            請檢查網路後再試一次。你也可以到「我的訂單」確認。
          </Banner>
        </div>
      </div>
    );
  }

  if (load.kind === 'notfound') {
    return (
      <ResultCard
        focusKey="notfound" icon={<SearchX size={48} strokeWidth={1.5} className="text-muted" />} title="找不到這筆付款"
        actions={<Link to="/orders" className={btnMain}>查看我的訂單</Link>}
      >
        可能是連結不對，或這筆付款屬於別的帳號。
      </ResultCard>
    );
  }

  const g = load.group;
  const cod = state?.cod ?? [];
  const n = g.orders.length;

  const shopList = (rows: { key: string; name: string; tag: PayTagKind; amount: number }[]) => (
    <ul className="mt-5 divide-y divide-line border-y border-line text-left text-ink">
      {rows.map(r => (
        <li key={r.key} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-1 py-3">
          <span className="min-w-0 flex-1 basis-28 text-sm font-medium">{r.name}</span>
          <span className="flex min-w-0 flex-wrap items-center justify-end gap-x-3 gap-y-1">
            <PayTag kind={r.tag} />
            <span className="min-w-16 text-right text-sm tabular-nums">{money(r.amount)}</span>
          </span>
        </li>
      ))}
    </ul>
  );

  switch (screen) {
    case 'paid': {
      const card = payments.find(p => p.card4);
      const cardText = card ? `（${card.card_brand ? `${brandLabel(card.card_brand)} ` : ''}•••• ${card.card4}）` : '';
      const codTotal = cod.reduce((s, c) => s + c.total, 0);
      return (
        <ResultCard
          focusKey="paid" icon={<CircleCheck size={64} strokeWidth={1.5} className="text-success" />} title="付款完成"
          actions={<><Link to="/" className={btnMain}>繼續購物</Link><Link to="/orders" className={btnSub}>查看訂單</Link></>}
        >
          <p>{cod.length > 0 ? `${n + cod.length} 筆訂單成立：${n} 筆已付款、${cod.length} 筆貨到付款。賣家會盡快出貨。` : `${n} 筆訂單成立，賣家會盡快出貨。`}</p>
          {shopList([
            ...g.orders.map(o => ({ key: o.orderId, name: nameOf(o.shopId), tag: 'paid' as const, amount: o.total })),
            ...cod.map(c => ({ key: c.orderNo, name: nameOf(c.shopId), tag: 'cod' as const, amount: c.total })),
          ])}
          <dl className="mt-4 space-y-1.5 text-left text-sm text-ink">
            <div className="flex flex-wrap justify-between gap-x-3"><dt>已付款{cardText}</dt><dd className="tabular-nums">{money(g.total)}</dd></div>
            {cod.length > 0 && <div className="flex flex-wrap justify-between gap-x-3"><dt>貨到付款（收到商品時付）</dt><dd className="tabular-nums">{money(codTotal)}</dd></div>}
            <div className="flex items-baseline justify-between gap-x-3 border-t border-line pt-2"><dt>訂單總額</dt><dd className="text-2xl text-brand tabular-nums">{money(g.total + codTotal)}</dd></div>
          </dl>
          {n > 1 && <p className="mt-3 text-left">你的信用卡帳單會有 {n} 筆，各自是一家店的金額。</p>}
        </ResultCard>
      );
    }

    case 'confirming':
      return (
        <ResultCard
          focusKey="confirming" icon={<Hourglass size={48} strokeWidth={1.5} className="text-info-text" />} title="付款結果確認中"
          actions={<><Link to="/orders" className={btnMain}>查看我的訂單</Link><button type="button" className={btnSub} aria-disabled={refreshing || undefined} onClick={() => { setRefreshing(true); void reload(true).finally(() => setRefreshing(false)); }}>{refreshing ? '確認中…' : '重新整理結果'}</button></>}
        >
          <p>我們正在向綠界科技確認 {n} 筆付款的結果。確認前無法再次付款，以免重複扣款。</p>
          <p className="mt-1">你可以離開這一頁，結果出來後會顯示在「我的訂單」。{pollStopped ? '' : '這一頁也會自動更新。'}</p>
          {shopList(g.orders.map(o => ({ key: o.orderId, name: nameOf(o.shopId), tag: 'confirming' as const, amount: o.total })))}
          <p role="status" className="sr-only">{pollStopped ? `已經等了超過 ${CONFIRM_POLL.maxMs / 60_000} 分鐘，請按「重新整理結果」` : ''}</p>
        </ResultCard>
      );

    case 'expired':
    case 'cancelled':
    case 'exhausted': {
      const text = screen === 'expired'
        ? [`付款逾時，訂單已取消`, `超過 30 分鐘沒有完成付款，${n} 筆訂單已自動取消，商品庫存已釋放。你沒有被請款。`]
        : screen === 'cancelled'
          ? ['訂單已取消', `這 ${n} 筆訂單已取消，商品庫存已釋放。你沒有被請款。`]
          : ['付款沒有成功，訂單已取消', `付款多次沒有成功，這 ${n} 筆訂單已取消，商品庫存已釋放。你沒有被請款。`];
      return (
        <ResultCard
          focusKey={screen} icon={<Ban size={48} strokeWidth={1.5} className="text-muted" />} title={text[0]}
          actions={<><Link to="/" className={btnMain}>繼續購物</Link><Link to="/orders" className={btnSub}>查看訂單</Link></>}
        >
          <p>{text[1]}</p>
          {shopList(g.orders.map(o => ({ key: o.orderId, name: nameOf(o.shopId), tag: 'cancelled' as const, amount: o.total })))}
        </ResultCard>
      );
    }

    default: {
      // pay（待付款）與 failed（失敗後換卡重付）共用重付區
      const failed = screen === 'failed' && g.lastFail ? g.lastFail : null;
      const sentences = failed
        ? failureSentences(failed, {
          failedShop: failed.shopId ? nameOf(failed.shopId) : null,
          otherShops: failed.shopId ? g.orders.filter(o => o.shopId !== failed.shopId).map(o => nameOf(o.shopId)) : [],
          orderCount: n,
        })
        : null;
      const system = failed !== null && (failed.shopId === null);
      const rows = g.orders.map(o => ({
        key: o.orderId, name: nameOf(o.shopId), amount: o.total,
        tag: (!failed ? 'pending' : system ? 'unprocessed' : o.shopId === failed.shopId ? 'failed' : 'cancelledAuth') as PayTagKind,
      }));
      const clock = clockText(g.expiresAt);
      const retryTitle = failed ? '換一張卡再付一次' : '選擇付款的卡';
      const shops = new Set(g.orders.map(o => o.shopId)).size;
      return (
        <div className="mx-auto max-w-lg space-y-2 p-3 pb-safe md:space-y-3 md:py-12">
          <div className="rounded-md bg-white px-5 py-8 text-center md:px-8">
            <div aria-hidden="true" className="flex justify-center">
              {failed ? <CircleAlert size={48} strokeWidth={1.5} className="text-error-text" /> : <CreditCard size={48} strokeWidth={1.5} className="text-muted" />}
            </div>
            <PageHeading key={failed ? 'failed' : 'pay'} text={failed ? '付款沒有完成' : '完成付款'} />
            {sentences ? (
              <div className="mt-2 text-sm leading-6 text-pretty">
                <p>{sentences.reason}</p>
                {sentences.cardInvalid && <p className="mt-1">這張卡已失效，建議到「付款方式」刪除。</p>}
                <p className="mt-1 text-muted">{sentences.result}</p>
              </div>
            ) : (
              <p className="mt-2 text-sm leading-6 text-muted">{n} 筆訂單等著付款。</p>
            )}
            {shopList(rows)}
          </div>

          <section aria-labelledby="retry-h" className="rounded-md bg-white p-4 md:p-6">
            <h2 id="retry-h" className="text-base font-bold">{retryTitle}</h2>
            {clock && <p className="mt-1 text-sm text-muted">請在 <span className="font-medium tabular-nums text-ink">{clock}</span> 前完成付款，逾時 {n} 筆訂單會自動取消。</p>}
            {(notice) && <div className="mt-3"><Banner kind="error" title="付款沒有完成">{notice}</Banner></div>}
            {!online && <div className="mt-3"><Banner kind="warning" role="status" title="目前沒有網路">連上網路後才能付款。</Banner></div>}
            {cardsHook.rows === null && cardsHook.phase === 'error' && (
              <div className="mt-3"><Banner kind="error" title="讀不到你的信用卡" actions={<button type="button" className={btnOutline} onClick={() => void cardsHook.reload()}>重試</button>}>請檢查網路後再試一次。</Banner></div>
            )}
            <div className="mt-3" ref={listRef}>
              <CardRadioList
                cards={cards} value={choice} onChange={c => { setChoice(c); setPickError(false); }} onNew={() => setBindOpen(true)}
                failedCardId={failedCardId} busy={paying} loading={cardsHook.rows === null && cardsHook.phase === 'loading'}
                labelledBy="retry-h" name="retry-choice"
              />
            </div>
            {pickError && <p role="alert" className="mt-2 text-sm text-error-text">請選擇付款的卡</p>}
            {slow && <p role="status" className="mt-3 text-sm">還在處理，請不要關閉或重新整理。</p>}
            <button
              type="button" onClick={() => void pay()} aria-disabled={paying || !online || undefined} aria-busy={paying || undefined}
              className={`${btnPrimary} mt-4 min-h-12 w-full py-2 text-base ${pressCls} ${paying ? 'cursor-wait' : ''}`}
            >
              {paying && <LoaderCircle size={18} className="motion-safe:animate-spin" aria-hidden="true" />}
              {paying ? '付款中…' : `付款 ${money(g.total)}${shops > 1 ? `（${shops} 家店）` : ''}`}
            </button>
            <button type="button" onClick={() => setCancelOpen(true)} aria-disabled={paying || undefined} className={`${textActionCls} mt-2 w-full justify-center text-error-text`}>
              取消這 {n} 筆訂單
            </button>
          </section>

          {cancelOpen && (
            <LeaveDialog
              title={`取消這 ${n} 筆訂單？`} description={`這 ${n} 筆是一起付款的，只能一起取消。商品庫存會釋放，你沒有被請款。`}
              stayLabel="保留訂單" leaveLabel="取消訂單" busy={cancelBusy} busyLabel="取消中…"
              onStay={() => setCancelOpen(false)} onLeave={() => void cancelAll()}
            />
          )}
          {bindOpen && (
            <BindSheet
              returnPath={BIND_RETURN_PATH} from="page" onClose={() => setBindOpen(false)}
              onBound={({ paymentMethodId }) => {
                setBindOpen(false);
                void cardsHook.reload(true).then(() => setChoice({ kind: 'card', cardId: paymentMethodId }));
              }}
              onResult={(no, hint) => navigate(`${BIND_RETURN_PATH}?bind=${hint}&no=${encodeURIComponent(no)}`)}
              onAuthLost={() => { setBindOpen(false); openLogin({ expired: true, trigger: { kind: 'goto' } }); }}
            />
          )}
        </div>
      );
    }
  }
}

/** h1 取得焦點並被朗讀（換成別種結果時重新朗讀） */
function PageHeading({ text }: { text: string }): ReactNode {
  const ref = useRef<HTMLHeadingElement>(null);
  useEffect(() => { window.scrollTo(0, 0); ref.current?.focus({ preventScroll: true }); }, [text]);
  return <h1 ref={ref} tabIndex={-1} className="mt-3 text-xl font-bold outline-none">{text}</h1>;
}
