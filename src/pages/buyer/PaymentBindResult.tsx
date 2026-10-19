import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { CircleAlert, CircleCheck, Hourglass, Info, LoaderCircle, UserRound } from 'lucide-react';
import { useStore } from '../../store/StoreContext';
import { useAuth } from '../../store/AuthContext';
import { btnOutline, btnPrimary } from '../../components/import/ui';
import { pressCls } from '../../components/account/ui';
import ResultCard from '../../components/payment/ResultCard';
import { browserStores } from '../../lib/auth/pending';
import { bindStatus, fetchPaymentMethods, isAuthError } from '../../lib/payment/api';
import { BIND_POLL, BIND_SESSION_KEY, bindKindOfStatus, bindSessionOf, parseBindReturn, type BindKind } from '../../lib/payment/bind';
import { brandLabel, cardBrandOf, expiryOf } from '../../lib/payment/cards';
import { takeCheckoutSnapshot } from '../../lib/payment/resumeCheckout';
import type { PaymentMethodRow } from '../../lib/payment/types';

type View = { kind: 'loading' } | { kind: 'unauth' } | { kind: BindKind; cardId: string | null };

const btnMain = `${btnPrimary} ${pressCls} h-12 w-full text-base`;
const btnSub = `${btnOutline} ${pressCls} h-12 w-full text-base`;

/**
 * 綁卡結果 #/account/payment-methods/result?bind=…&no=…（S-3 結果頁）。
 * 網址參數只用來決定「查哪一筆」，結果一律以伺服器查詢為準；沒有任何自動跳轉、沒有動畫。
 * 結果存在伺服器：換瀏覽器（LINE → Safari）登入後，到付款方式頁一樣看得到新卡。
 */
export default function PaymentBindResult() {
  const { user, authReady } = useStore();
  const { openLogin } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const ret = parseBindReturn(params);
  const no = ret?.no ?? null;
  const uid = user?.id ?? null;
  const [view, setView] = useState<View>({ kind: 'loading' });
  const [card, setCard] = useState<PaymentMethodRow | null>(null);
  const [round, setRound] = useState(0);
  const from = no ? bindSessionOf(readSession(), no)?.from ?? 'page' : 'page';
  const once = useRef(0);

  useEffect(() => {
    if (!authReady) return;
    if (!uid) { setView({ kind: 'unauth' }); return; }
    if (!no) { setView({ kind: 'unknown', cardId: null }); return; }
    let alive = true;
    const started = Date.now();
    const mine = ++once.current;
    setView({ kind: 'loading' });
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      try {
        const res = await bindStatus(no);
        if (!alive || mine !== once.current) return;
        const kind = bindKindOfStatus(res);
        if (kind === 'pending') {
          if (Date.now() - started >= BIND_POLL.maxMs) setView({ kind: 'unknown', cardId: null });
          else timer = setTimeout(() => void tick(), BIND_POLL.intervalMs);
          return;
        }
        const cardId = res.status === 'bound' ? res.paymentMethodId : null;
        setView({ kind, cardId });
      } catch (e) {
        if (!alive || mine !== once.current) return;
        setView(isAuthError(e) ? { kind: 'unauth' } : { kind: 'unknown', cardId: null });
      }
    };
    void tick();
    return () => { alive = false; clearTimeout(timer); };
  }, [authReady, uid, no, round]);

  // 綁好了：把這張卡的卡別、末四碼、有效期限讀出來顯示（讀不到就只顯示一般文字，不影響結果）
  const boundId = view.kind === 'success' || view.kind === 'duplicate' ? view.cardId : null;
  useEffect(() => {
    if (!boundId) return;
    let alive = true;
    fetchPaymentMethods().then(rows => { if (alive) setCard(rows.find(r => r.id === boundId) ?? null); }, () => undefined);
    return () => { alive = false; };
  }, [boundId]);

  const backToCheckout = useCallback(() => {
    const snap = takeCheckoutSnapshot(browserStores(), Date.now());
    if (!snap) { navigate('/cart', { replace: true }); return; }
    navigate('/checkout', {
      replace: true,
      state: { items: snap.items, fromCart: snap.fromCart, payment: boundId ? 'ecpay_card' : snap.payment, cardId: boundId ?? snap.cardId, address: snap.address, reauth: false },
    });
  }, [navigate, boundId]);

  const toMethods = <Link to="/account/payment-methods" className={from === 'checkout' ? btnSub : btnMain}>回到付款方式</Link>;
  const checkoutBtn = <button type="button" onClick={backToCheckout} className={btnMain}>回到結帳</button>;

  if (view.kind === 'loading') {
    return (
      <div role="status" className="mx-auto max-w-lg p-3 md:py-12">
        <div className="rounded-md bg-white px-5 py-12 text-center">
          <LoaderCircle size={32} className="mx-auto text-muted motion-safe:animate-spin" aria-hidden="true" />
          <p className="mt-4 font-medium">正在確認綁定結果…</p>
          <p className="mt-1 text-sm text-muted">請不要關閉這一頁。</p>
        </div>
      </div>
    );
  }

  if (view.kind === 'unauth') {
    return (
      <ResultCard
        focusKey="unauth" icon={<UserRound size={56} strokeWidth={1.5} className="text-muted" />} title="請登入後查看結果"
        actions={<button type="button" className={btnMain} onClick={() => openLogin({ trigger: { kind: 'goto' } })}>登入</button>}
      >
        沒有登入時，不會顯示卡片資訊。登入後，到「付款方式」就能看到綁定結果。
      </ResultCard>
    );
  }

  if (view.kind === 'success' || view.kind === 'duplicate') {
    const dup = view.kind === 'duplicate';
    const name = card ? `${brandLabel(cardBrandOf(card))} •••• ${card.card4}` : '';
    const exp = card ? `有效至 ${expiryOf(card.exp_year, card.exp_month).text}${card.is_default ? '・已設為預設卡' : ''}` : '';
    return (
      <ResultCard
        focusKey={view.kind} icon={dup ? <Info size={56} strokeWidth={1.5} className="text-info-text" /> : <CircleCheck size={56} strokeWidth={1.5} className="text-success" />}
        title={dup ? '這張卡已經綁定過了' : '已綁定信用卡'}
        actions={from === 'checkout' ? <>{checkoutBtn}{toMethods}</> : toMethods}
      >
        {dup
          ? <>{card ? `${brandLabel(cardBrandOf(card))} 末四碼 ${card.card4}` : '這張卡'}本來就在你的付款方式裡，沒有重複新增。</>
          : card && <><span className="block text-base font-medium text-ink tabular-nums">{name}</span><span className="block">{exp}</span></>}
      </ResultCard>
    );
  }

  if (view.kind === 'declined') {
    return (
      <ResultCard
        focusKey="declined" icon={<CircleAlert size={56} strokeWidth={1.5} className="text-error-text" />} title="綁定沒有成功"
        actions={<><Link to="/account/payment-methods/new" className={btnMain}>重新綁定</Link>{toMethods}</>}
      >
        發卡銀行未通過，請改用其他卡或聯絡銀行。這張卡沒有被綁定。
      </ResultCard>
    );
  }

  // unknown（查不到、逾時）：請先不要重綁同一張卡，以免重複（R-B7）
  return (
    <ResultCard
      focusKey="unknown" icon={<Hourglass size={56} strokeWidth={1.5} className="text-warning-text" />} title="還不確定有沒有綁定成功"
      actions={<><Link to="/account/payment-methods" className={btnMain}>到付款方式</Link><button type="button" className={btnSub} onClick={() => setRound(n => n + 1)}>重新確認結果</button></>}
    >
      請先不要重新綁同一張卡，以免重複。到「付款方式」看一下，列表裡有這張卡就是成功了。
    </ResultCard>
  );
}

function readSession(): string | null {
  try { return sessionStorage.getItem(BIND_SESSION_KEY); } catch { return null; }
}
