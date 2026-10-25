import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { CheckCircle2, Info, Loader2, MapPin, Store, UserRound } from 'lucide-react';
import { shippingFor, useStore } from '../../store/StoreContext';
import { useAuth } from '../../store/AuthContext';
import LoginRequired from '../../components/auth/LoginRequired';
import Banner from '../../components/import/Banner';
import { btnOutline, btnPrimary } from '../../components/import/ui';
import AddressFields from '../../components/account/AddressFields';
import AddressSheet from '../../components/account/AddressSheet';
import { AddressSummary, snapshotLine, snapshotPhone } from '../../components/account/AddressView';
import { focusFirstError, useAddressForm } from '../../components/account/useAddressForm';
import { Bone, CheckRow, pressCls } from '../../components/account/ui';
import BindSheet from '../../components/payment/BindSheet';
import { CardName } from '../../components/payment/CardLabel';
import CardRadioList from '../../components/payment/CardRadioList';
import PayGroup from '../../components/payment/PayGroup';
import { BIND_RETURN_PATH } from './PaymentMethodNew';
import { EMPTY_DRAFT, normalizePhone, type AddressDraft } from '../../lib/account/address';
import { saveAddress } from '../../lib/account/addresses';
import { addressFromDraft, buyerOf, pickBookAddress } from '../../lib/account/checkoutAddress';
import { accountErrorText, toAccountError } from '../../lib/account/errors';
import { useAddressBook } from '../../lib/account/useAddressBook';
import { signedInText } from '../../lib/auth/identity';
import { browserStores, buildPending, savePending, type CheckoutAddress } from '../../lib/auth/pending';
import { errorCodeOf, fetchShopsOnlinePayable, isAuthError, payErrorText, payGroup } from '../../lib/payment/api';
import type { PaymentErrorCode } from '../../lib/payment/types';
import { brandLabel, cardBrandOf } from '../../lib/payment/cards';
import { rememberPayCard } from '../../lib/payment/lastCard';
import { ONLINE_SHOP_LIMIT, payButtonLabel, planCheckout, preselectChoice, type CodReason, type PayChoice } from '../../lib/payment/plan';
import { destinationOfPayError, SLOW_PAY_MS, WAIT_PAY_MS } from '../../lib/payment/screens';
import { refreshPaymentConfig, usePaymentConfig } from '../../lib/payment/usePaymentConfig';
import { useCards } from '../../lib/payment/useCards';
import ProductImage from '../../components/ProductImage';
import CheckoutRejected from '../../components/checkout/CheckoutRejected';
import EmptyState from '../../components/EmptyState';
import { money } from '../../lib/format';
import type { CartItem, CheckoutRejection, Order } from '../../types';

type LegacyPay = Exclude<Order['payment'], 'ecpay_card'>;

/** 線上付款開關關著時的舊付款方式（含示範用的信用卡、ATM 轉帳）；開關打開後由真的信用卡與貨到付款取代（D11） */
const PAYMENTS: { id: LegacyPay; label: string }[] = [
  { id: 'cod', label: '貨到付款' },
  { id: 'card', label: '信用卡（示範）' },
  { id: 'transfer', label: 'ATM 轉帳' },
];

/** 地址簿超過這麼久沒回應就當作讀不到，改手動填寫（A-19） */
const BOOK_TIMEOUT_MS = 5_000;
/** 信用卡清單同理：超過 5 秒沒回應就只剩貨到付款（不擋下單） */
const CARDS_TIMEOUT_MS = 5_000;
/** 下單時資料庫回這些代碼＝沒有建單，開通狀態、單店金額上限或功能開關和畫面上看到的不同 */
const PAY_PRECHECK_CODES = ['SHOP_NOT_ONLINE', 'ONLINE_AMOUNT_LIMIT', 'PAYMENT_DISABLED'];

/** 結帳頁要先登入。sticky：登入在填寫途中過期時，頁面不能被換掉（收件資料、付款方式會消失），改開登入面板蓋在上面 */
export default function Checkout() {
  // 登入回來時，待辦動作是在頁面已經畫出來之後才帶著結帳狀態導到這一頁（同一個網址、新的 location.state）：
  // 用 location.key 當 key 讓頁面重新掛載，品項、付款方式、收件資料才會從新的 state 還原
  const { key } = useLocation();
  return (
    <LoginRequired kind="checkout" sticky>
      <CheckoutView key={key} />
    </LoginRequired>
  );
}

interface CheckoutState { items?: CartItem[]; fromCart?: boolean; payment?: Order['payment']; cardId?: string | null; address?: CheckoutAddress; reauth?: boolean }

const draftOfSnapshot = (a: CheckoutAddress): AddressDraft => ({ recipient: a.name, phone: a.phone, city: a.city, district: a.district, detail: a.detail });

function CheckoutView() {
  const { state } = useLocation() as { state: CheckoutState | null };
  const { getProduct, getShop, checkout, user } = useStore();
  const { openLogin } = useAuth();

  // 重新登入回來時，登入前的收件資料以待辦動作帶回來的快照為準（地址簿那筆即使已被刪也照樣還原，AC-A25）
  const restored = state?.address ?? null;
  const frozen = restored?.source === 'book' ? restored : null;
  const manualRestored = restored?.source === 'manual' ? restored : null;

  const book = useAddressBook({ timeoutMs: BOOK_TIMEOUT_MS });
  const { rows, phase } = book;
  const form = useAddressForm(manualRestored ? draftOfSnapshot(manualRestored) : EMPTY_DRAFT, false);
  const [saveBox, setSaveBox] = useState(manualRestored?.saveToBook ?? true);
  const [pickId, setPickId] = useState<string | null>(frozen?.bookId ?? null);
  // 地址簿讀不到時使用者開始手填：之後即使地址簿讀到了，也不能把填到一半的內容換掉
  const [manualLocked, setManualLocked] = useState(Boolean(manualRestored));
  const [degraded, setDegraded] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [announce, setAnnounce] = useState('');
  const [saveWarning, setSaveWarning] = useState(false);
  const summaryRef = useRef<HTMLDivElement>(null);
  const [focusSummary, setFocusSummary] = useState(false);

  const [reauthNotice, setReauthNotice] = useState(Boolean(state?.reauth));
  const [payment, setPayment] = useState<LegacyPay>(state?.payment && state.payment !== 'ecpay_card' ? state.payment : 'cod');
  const [done, setDone] = useState<Order[] | null>(null);
  const [rejected, setRejected] = useState<CheckoutRejection[] | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [ownShopError, setOwnShopError] = useState(false);

  useEffect(() => { if (phase === 'error') setDegraded(true); }, [phase]);

  // 選好地址後焦點回到收件資訊摘要（R-A17）。要等抽屜卸載、它把焦點還給「更換」鈕之後再移，所以放在 effect 裡
  useEffect(() => {
    if (!focusSummary || sheetOpen) return;
    summaryRef.current?.focus();
    setFocusSummary(false);
  }, [focusSummary, sheetOpen]);

  const items = state?.items ?? [];

  const groups = useMemo(() => {
    const map = new Map<string, { item: CartItem; title: string; image: string; variantName: string; price: number }[]>();
    for (const item of items) {
      const p = getProduct(item.productId);
      const v = p?.variants.find(x => x.id === item.variantId);
      if (!p || !v) continue;
      map.set(p.shopId, [...(map.get(p.shopId) ?? []), { item, title: p.title, image: p.images[0], variantName: v.name, price: v.price }]);
    }
    return [...map.entries()].map(([shopId, rows]) => {
      const subtotal = rows.reduce((s, r) => s + r.price * r.item.qty, 0);
      return { shopId, rows, subtotal, shipping: shippingFor(subtotal, rows.map(r => getProduct(r.item.productId))) };
    });
    // 只在進頁時計算一次：結帳成功後庫存會變，不該讓摘要跟著跳。
    // 這份結果同時是畫面上的單價與每店運費，也是送出時帶給伺服器比對的「看到的價格／運費」（不重算）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // 讀不到商品或規格的品項列不出來，也不送出（spec 4.1 第 2 點）
  const unlisted = items.length - groups.reduce((n, g) => n + g.rows.length, 0);

  // ── 線上付款（開關打開時）：信用卡、哪些店能線上付、買家選了什麼。開關關著或讀不到時整段不啟動，舊流程原樣 ──
  const navigate = useNavigate();
  const paymentCfg = usePaymentConfig();
  const online = paymentCfg.enabled;
  const cardsHook = useCards({ timeoutMs: CARDS_TIMEOUT_MS, paused: !online });
  const cards = cardsHook.rows ?? [];
  const cardsDegraded = online && cardsHook.rows === null && cardsHook.phase === 'error';
  const [payable, setPayable] = useState<Record<string, boolean> | null>(null);
  const [payableFailed, setPayableFailed] = useState(false);
  const [choice, setChoice] = useState<PayChoice | null>(null);
  const [bindOpen, setBindOpen] = useState(false);
  const [focusChoice, setFocusChoice] = useState(false);
  const [payAnnounce, setPayAnnounce] = useState('');
  const [slow, setSlow] = useState(false);
  const [cardsRetrying, setCardsRetrying] = useState(false);

  const loadPayable = () => {
    setPayableFailed(false);
    fetchShopsOnlinePayable(groups.map(g => g.shopId)).then(setPayable, () => setPayableFailed(true));
  };
  useEffect(() => { if (online && groups.length) loadPayable(); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [online]);

  const planShops = groups.map(g => ({ shopId: g.shopId, total: g.subtotal + g.shipping }));
  const canOnline = online && !cardsDegraded && payable !== null;
  const anyPayable = planCheckout({ shops: planShops, choice: { kind: 'cod' }, enabled: canOnline, payable: payable ?? {} }).anyOnlinePayable;
  const settled = (cardsHook.rows !== null || cardsHook.phase === 'error') && (payable !== null || payableFailed);
  // 重新登入、從綁卡回來：選擇由待辦動作的快照帶回（卡不見或過期就改用預設規則）
  const restoredChoice: PayChoice | null = state?.address
    ? (state.payment === 'ecpay_card' && state.cardId ? { kind: 'card', cardId: state.cardId } : { kind: 'cod' })
    : null;
  useEffect(() => {
    if (choice !== null || !online || !settled) return;
    if (restoredChoice?.kind === 'cod') { setChoice(restoredChoice); return; }
    if (restoredChoice?.kind === 'card') {
      const c = cards.find(x => x.id === restoredChoice.cardId);
      if (c && !c.expired) { setChoice(restoredChoice); return; }
    }
    setChoice(preselectChoice(cards, anyPayable));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [choice, online, settled, cardsHook.rows, anyPayable]);
  // 選好的卡在別處被刪了：回到預設規則
  useEffect(() => {
    if (choice?.kind === 'card' && cardsHook.rows && !cardsHook.rows.some(c => c.id === choice.cardId)) setChoice(preselectChoice(cardsHook.rows, anyPayable));
  }, [choice, cardsHook.rows, anyPayable]);
  // 綁好新卡、抽屜關閉後，焦點回到選中的那一列
  useEffect(() => {
    if (!focusChoice || bindOpen) return;
    document.querySelector<HTMLInputElement>('input[name="pay-choice"]:checked')?.focus();
    setFocusChoice(false);
  }, [focusChoice, bindOpen]);

  const effectiveChoice: PayChoice = choice ?? { kind: 'cod' };
  const plan = planCheckout({ shops: planShops, choice: effectiveChoice, enabled: canOnline, payable: payable ?? {} });
  const chosenCard = effectiveChoice.kind === 'card' ? cards.find(c => c.id === effectiveChoice.cardId) : undefined;
  const paymentLoading = online && choice === null;

  const cardTextOf = (id: string) => {
    const c = cards.find(x => x.id === id);
    return c ? `${brandLabel(cardBrandOf(c))} 末四碼 ${c.card4}` : '這張卡';
  };
  const pickChoice = (c: PayChoice) => {
    setChoice(c);
    const p = planCheckout({ shops: planShops, choice: c, enabled: canOnline, payable: payable ?? {} });
    setPayAnnounce(c.kind === 'cod'
      ? `改選貨到付款，${p.cod.length} 家店全部貨到付款`
      : `已改選 ${cardTextOf(c.cardId)}，${p.onlineCount} 家店線上付款${p.cod.length ? `、${p.cod.length} 家貨到付款` : ''}`);
  };
  const retryCards = async () => { setCardsRetrying(true); await cardsHook.reload(); loadPayable(); setCardsRetrying(false); };

  // 收件資訊的三種情況（設計 7）：a 地址簿有資料＝摘要；b 地址簿是空的＝表單＋「存到我的地址」；c 讀不到＝表單＋重試
  const bookAddr = pickBookAddress(rows, pickId, frozen);
  const bookEmpty = rows !== null && rows.length === 0;
  const showSummary = bookAddr !== null && !manualLocked;
  const showForm = !showSummary && (manualLocked || bookEmpty || (rows === null && degraded));
  const loadingBook = !showSummary && !showForm;
  const offerSave = showForm && bookEmpty;
  const savedBookArrived = showForm && manualLocked && rows !== null && rows.length > 0;

  if (done) {
    return (
      <div className="mx-auto max-w-lg p-3 md:py-12">
        <div className="flex flex-col items-center gap-3 rounded-md bg-white px-6 py-12 text-center">
          <CheckCircle2 size={64} className="text-success" strokeWidth={1.5} />
          <h1 className="text-xl font-bold">訂單成立！</h1>
          <p className="text-sm text-muted">共 {done.length} 筆訂單（依商店分開出貨），賣家會盡快為你出貨。</p>
          {saveWarning && (
            <div className="w-full text-left">
              <Banner kind="warning" role="status" title="訂單已成立，但這組地址沒有存進「我的地址」">
                可以到「我的帳號 › 地址」再新增。
              </Banner>
            </div>
          )}
          <div className="mt-4 flex gap-3">
            <Link to="/orders" className="rounded-sm border border-brand px-6 py-2.5 text-sm text-brand">查看訂單</Link>
            <Link to="/" className="rounded-sm bg-brand px-6 py-2.5 text-sm text-white">繼續購物</Link>
          </div>
        </div>
      </div>
    );
  }

  if (rejected) {
    return (
      <CheckoutRejected
        changes={rejected} fromCart={!!state?.fromCart}
        shopOrder={groups.map(g => g.shopId)}
        submitted={groups.flatMap(g => g.rows.map(r => r.item))}
        shopName={id => getShop(id)?.name} imageOf={id => getProduct(id)?.images[0]}
      />
    );
  }

  if (!groups.length) {
    return (
      <div className="mx-auto max-w-6xl p-3 md:p-6">
        <EmptyState title="沒有要結帳的商品" action={<Link to="/cart" className="text-brand">回購物車</Link>} />
      </div>
    );
  }

  const subtotal = groups.reduce((s, g) => s + g.subtotal, 0);
  const shipping = groups.reduce((s, g) => s + g.shipping, 0);

  // 登入過期：收件資料、付款方式、品項都留在頁面上；登入後由待辦動作原樣還原，按一次「下訂單」即可
  const snapshotOf = (address: CheckoutAddress) => ({
    kind: 'checkout' as const, items, fromCart: !!state?.fromCart, address,
    payment: online ? (effectiveChoice.kind === 'card' ? 'ecpay_card' as const : 'cod' as const) : payment,
    cardId: online && effectiveChoice.kind === 'card' ? effectiveChoice.cardId : null,
  });
  const askRelogin = (address: CheckoutAddress) => openLogin({ expired: true, trigger: snapshotOf(address) });

  /** 離開結帳去綁卡（3D 驗證整頁跳轉）：結帳的狀態存進待辦動作，回來時從結果頁「回到結帳」還原。收件資料此刻不驗證，原樣存 */
  const saveCheckoutSnapshot = () => {
    const address = showSummary && bookAddr ? bookAddr : addressFromDraft(form.draft, saveBox);
    savePending(browserStores(), buildPending(snapshotOf(address), '/checkout', Date.now()));
  };


  /** 呼叫 payment-pay（每家店各授權一筆，可能數十秒），然後去付款結果頁。超過 45 秒不再等，結果頁會輪詢確認中 */
  const payAndGo = async (groupId: string, cardId: string, orders: Order[]) => {
    const cod = orders.filter(o => o.payment === 'cod').map(o => ({ shopId: o.shopId, total: o.total, orderNo: o.orderNo }));
    const [store] = browserStores();
    if (store) rememberPayCard(store, groupId, cardId); // 付款失敗後重付頁用它知道「剛失敗的是哪張卡」
    const slowTimer = setTimeout(() => setSlow(true), SLOW_PAY_MS);
    let notice: string | undefined;
    try {
      await Promise.race([payGroup(groupId, cardId), new Promise<void>(r => setTimeout(r, WAIT_PAY_MS))]);
    } catch (e) {
      // 已付款、處理中、逾時由結果頁依伺服器狀態呈現；其餘（卡不見了、店不能線上付、網路）在結果頁上方說明，訂單仍在待付款可重付
      const code = errorCodeOf(e);
      if (isAuthError(e) || (code && destinationOfPayError(code as PaymentErrorCode))) notice = undefined;
      else notice = payErrorText(e, '付款沒有完成，請再試一次。');
    } finally {
      clearTimeout(slowTimer);
    }
    navigate(`/pay/${groupId}`, { replace: true, state: { cod, notice } });
  };

  const retryBook = async () => {
    setRetrying(true);
    await book.reload();
    setRetrying(false);
  };

  const adoptBook = () => {
    form.reset(EMPTY_DRAFT);
    setManualLocked(false);
    setPickId(null);
  };

  const onFormChange = (d: AddressDraft) => {
    form.change(d);
    if (rows === null) setManualLocked(true);
  };

  const useRow = (id: string) => {
    const row = rows?.find(r => r.id === id);
    setPickId(id);
    setSheetOpen(false);
    if (row) setAnnounce(`已改選 ${row.recipient} 的地址`);
    setFocusSummary(true);
  };

  const submit = async () => {
    if (submitting) return;
    let address: CheckoutAddress;
    if (showSummary && bookAddr) {
      address = bookAddr;
    } else {
      // 讀取中就按「下訂單」＝沒有收件資料：直接轉成手動表單並報錯誤（設計 7.4）
      if (loadingBook) { setManualLocked(true); setDegraded(true); }
      const errs = form.validateAll();
      if (Object.keys(errs).length > 0) {
        requestAnimationFrame(() => focusFirstError(errs, 'ck'));
        return;
      }
      address = addressFromDraft(form.draft, saveBox);
    }
    if (!user) { askRelogin(address); return; }
    const onlineIds = plan.online.map(s => s.shopId);
    if (onlineIds.length > 0 && (!chosenCard || chosenCard.expired)) { setSubmitError('請選擇付款的卡'); return; }
    setSubmitting(true);
    setSubmitError('');
    setOwnShopError(false);
    try {
      const result = await checkout({
        items: groups.flatMap(g => g.rows.map(r => ({ ...r.item, price: r.price }))),
        seenShipping: Object.fromEntries(groups.map(g => [g.shopId, g.shipping])),
        buyer: buyerOf(address), payment: online ? 'cod' : payment, fromCart: !!state?.fromCart,
        onlineShopIds: online && onlineIds.length > 0 ? onlineIds : undefined,
      });
      if (result.outcome === 'rejected') {
        setRejected(result.changes);
        return;
      }
      // 線上付款：訂單已建成待付款，這一頁不能再讓使用者送出第二次（會重複建單）。不論付款結果、錯誤，一律去付款頁，結果以伺服器為準
      if (result.online && chosenCard) {
        await payAndGo(result.online.payGroupId, chosenCard.id, result.orders);
        return;
      }
      setDone(result.orders);
      window.scrollTo(0, 0);
      // 先建訂單、再存地址：存地址失敗（網路、上限…）訂單照樣成立，只提醒一聲，不重試也不阻擋
      if (address.source === 'manual' && offerSave && saveBox) {
        const phone = normalizePhone(address.phone);
        if (!phone) { setSaveWarning(true); } else {
          try {
            await saveAddress({
              id: null, recipient: address.name, phone, city: address.city, district: address.district,
              zip: address.zip, detail: address.detail, isDefault: false,
            });
          } catch {
            setSaveWarning(true);
          }
        }
      }
    } catch (err) {
      const e = toAccountError(err);
      if (e.kind === 'auth') {
        askRelogin(address);
      } else if (e.code === 'OWN_SHOP') {
        setSubmitError('購物車有自己商店的商品，無法下單');
        setOwnShopError(true);
      } else if (e.code && PAY_PRECHECK_CODES.includes(e.code)) {
        // 開通狀態、金額上限、功能開關在送出前後變了：沒有建單。重讀後畫面會跟著換分組
        setSubmitError(payErrorText(e, '下單失敗，請再試一次'));
        loadPayable();
        void refreshPaymentConfig();
      } else {
        // 價格、庫存、運費的變動不會走到這裡（改走失敗畫面）；這裡是下架、規格不見、網路、後端未升級等，
        // 資料庫的錯誤訊息本身是中文
        setSubmitError(accountErrorText(e, '下單失敗，請再試一次'));
      }
    } finally {
      setSubmitting(false);
    }
  };

  // 金額三列：手機顯示在付款方式下面，桌機顯示在右側摘要卡
  const summaryRows = (
    <>
      <div className="flex justify-between"><dt className="text-muted">商品總金額</dt><dd>{money(subtotal)}</dd></div>
      <div className="flex justify-between"><dt className="text-muted">運費總金額</dt><dd>{money(shipping)}</dd></div>
      <div className="flex items-center justify-between border-t border-line pt-3"><dt className="text-muted">總付款金額</dt><dd className="text-2xl text-brand">{money(subtotal + shipping)}</dd></div>
      {online && !paymentLoading && (
        <div className="space-y-2 border-t border-line pt-3">
          {plan.onlineCount > 0 && <div className="flex justify-between gap-3"><dt className="text-muted">線上付款（{plan.onlineCount} 家店）</dt><dd className="tabular-nums">{money(plan.onlineTotal)}</dd></div>}
          {plan.cod.length > 0 && <div className="flex justify-between gap-3"><dt className="text-muted">貨到付款</dt><dd className="tabular-nums">{money(plan.codTotal)}</dd></div>}
        </div>
      )}
    </>
  );

  /** 店家區塊（現況）。貨到付款組裡「不能線上付款」的店在底部寫原因 */
  const shopSection = (g: (typeof groups)[number], reason: CodReason | null = null) => (
    <section key={g.shopId} className="bg-white md:rounded-md">
      <header className="flex items-center gap-1.5 border-b border-line px-4 py-3 text-sm font-medium md:px-6">
        <Store size={16} /> {getShop(g.shopId)?.name}
      </header>
      {g.rows.map(r => (
        <div key={`${r.item.productId}|${r.item.variantId}`} className="flex items-center gap-3 px-4 py-3 md:px-6">
          <ProductImage src={r.image} alt="" size="sm" className="w-14 rounded-sm border border-line" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm">{r.title}</p>
            <p className="text-xs text-muted">規格：{r.variantName}</p>
          </div>
          <p className="text-sm text-muted">{money(r.price)} × {r.item.qty}</p>
          <p className="hidden w-24 text-right text-sm md:block">{money(r.price * r.item.qty)}</p>
        </div>
      ))}
      <div className="flex justify-between border-t border-dashed border-line bg-[#fafdff] px-4 py-3 text-sm md:px-6">
        <span className="text-muted">運費 {g.shipping === 0 && <span className="text-success">（免運）</span>}</span>
        <span>{money(g.shipping)}</span>
      </div>
      {reason && (
        <p className="flex items-start gap-1.5 border-t border-line bg-subtle px-4 py-2.5 text-sm md:px-6">
          <Info size={16} className="mt-0.5 shrink-0 text-info-text" aria-hidden="true" />
          {reason === 'not_enrolled' ? '這家店還沒開通線上付款，只能貨到付款。' : `這家店的金額超過線上付款的單筆上限（${money(ONLINE_SHOP_LIMIT)}），只能貨到付款。`}
        </p>
      )}
    </section>
  );
  const shopOf = (id: string) => groups.find(g => g.shopId === id)!;
  const payLabel = payButtonLabel(plan);
  const payingOnline = submitting && plan.onlineCount > 0;

  return (
    <div aria-busy={submitting || undefined} className={`mx-auto max-w-6xl ${online ? 'pb-40' : 'pb-28'} md:px-4 md:pt-6 lg:grid lg:grid-cols-[1fr_320px] lg:items-start lg:gap-4 lg:pb-10`}>
      {/* 桌機：左內容 + 右側訂單摘要（手機用底部固定列） */}
      <div className="min-w-0 space-y-2 md:space-y-4">
      {reauthNotice && (
        <div className="px-2 pt-2 md:px-0 md:pt-0">
          <Banner kind="info" role="status" title="已重新登入" actions={<button type="button" className={btnOutline} onClick={() => setReauthNotice(false)}>知道了</button>}>
            你填的資料都還在，可以繼續下單。
          </Banner>
        </div>
      )}
      {unlisted > 0 && (
        <div className="px-2 pt-2 md:px-0 md:pt-0">
          <Banner kind="warning" role="status" title={`有 ${unlisted} 件商品已無法購買，這次不會一起下單`} />
        </div>
      )}
      <section className="bg-white p-4 md:rounded-md md:p-6">
        <div className="-mx-4 -mt-4 mb-4 h-1 bg-[repeating-linear-gradient(45deg,#6fa6d6_0,#6fa6d6_33px,transparent_0,transparent_41px,#f18d9b_0,#f18d9b_74px,transparent_0,transparent_82px)] md:-mx-6 md:-mt-6 md:rounded-t-md" />
        <h2 className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-brand">
          <span className="flex items-center gap-1.5 whitespace-nowrap"><MapPin size={18} aria-hidden="true" /> 收件資訊</span>
          <span className="ml-auto flex min-w-0 items-center gap-1 text-xs font-normal text-muted">
            <UserRound size={14} className="shrink-0" aria-hidden="true" />
            <span className="truncate">{user ? signedInText(user) : '登入已過期'}</span>
          </span>
        </h2>
        <p role="status" className="sr-only">{announce}</p>

        {loadingBook && (
          <div aria-busy="true">
            <p role="status" className="sr-only">正在讀取你的地址</p>
            <Bone className="h-5 w-48" />
            <Bone className="mt-2 h-4 w-full" />
          </div>
        )}

        {showSummary && bookAddr && (
          <div ref={summaryRef} role="group" aria-label="收件地址" tabIndex={-1} className="flex flex-wrap items-start gap-x-3 gap-y-2 outline-none">
            <div className="min-w-0 flex-1 basis-48">
              <AddressSummary
                name={bookAddr.name} phone={snapshotPhone(bookAddr)} line={snapshotLine(bookAddr)}
                isDefault={Boolean(rows?.find(r => r.id === bookAddr.bookId)?.is_default)}
              />
            </div>
            <button
              type="button" aria-haspopup="dialog" aria-label="更換收件地址" onClick={() => setSheetOpen(true)}
              className={`${btnOutline} shrink-0`}
            >
              更換
            </button>
          </div>
        )}

        {showForm && (
          <div>
            {rows === null && degraded && (
              <div className="mb-4">
                <Banner
                  kind="warning" role="status" title="讀不到你的地址，先手動填寫"
                  actions={<button type="button" className={btnOutline} aria-disabled={retrying || undefined} aria-busy={retrying || undefined} onClick={() => { if (!retrying) void retryBook(); }}>{retrying ? '重試中…' : '重試'}</button>}
                >
                  這次填的資料不會自動存進「我的地址」。
                </Banner>
              </div>
            )}
            {savedBookArrived && (
              <div className="mb-4">
                <Banner
                  kind="info" role="status" title="已讀到你的地址"
                  actions={<button type="button" className={btnOutline} onClick={adoptBook}>改用已存的地址</button>}
                >
                  你填的內容還在。要改用已存的地址嗎？
                </Banner>
              </div>
            )}
            <AddressFields value={form.draft} errors={form.errors} idPrefix="ck" onChange={onFormChange} onBlurField={form.blur} />
            {offerSave && (
              <CheckRow
                id="ck-save" label="存到我的地址" checked={saveBox} onChange={setSaveBox}
                note="存起來之後，下次結帳會自動帶入，也可以在「我的帳號 › 地址」管理。"
              />
            )}
          </div>
        )}
      </section>

      {online ? (
        <>
          <section aria-labelledby="pay-h" className="bg-white p-4 md:rounded-md md:p-6">
            <h2 id="pay-h" className="mb-3">付款方式</h2>
            <p role="status" className="sr-only">{payAnnounce}</p>
            {cardsDegraded && (
              <div className="mb-3">
                <Banner
                  kind="warning" role="status" title="讀不到你的信用卡，先用貨到付款"
                  actions={<button type="button" className={btnOutline} aria-disabled={cardsRetrying || undefined} aria-busy={cardsRetrying || undefined} onClick={() => { if (!cardsRetrying) void retryCards(); }}>{cardsRetrying ? '重試中…' : '重試'}</button>}
                >
                  不影響下單，貨到付款照常可用。
                </Banner>
              </div>
            )}
            {!cardsDegraded && settled && !anyPayable && (
              <p role="status" className="mb-3 text-sm text-muted">這次的商店都還不能線上付款，只能貨到付款。</p>
            )}
            <CardRadioList
              cards={cards} value={choice} onChange={pickChoice} onNew={() => setBindOpen(true)} withCod
              showCards={!cardsDegraded && (!settled || anyPayable)} loading={!settled && !cardsDegraded}
              busy={submitting} labelledBy="pay-h"
            />
          </section>

          {!paymentLoading && (
            <div className="space-y-2 md:space-y-4">
              {plan.online.length > 0 && (
                <PayGroup
                  id="grp-on" kind="online" subtotal={plan.onlineTotal} shopCount={plan.onlineCount}
                  cardName={chosenCard ? <span className="inline-flex flex-wrap gap-x-2"><CardName card={chosenCard} /></span> : undefined}
                >
                  {plan.online.map(s => shopSection(shopOf(s.shopId)))}
                </PayGroup>
              )}
              {plan.cod.length > 0 && (
                <PayGroup id="grp-off" kind="cod" subtotal={plan.codTotal} shopCount={plan.cod.length}>
                  {plan.cod.map(s => shopSection(shopOf(s.shopId), s.reason))}
                </PayGroup>
              )}
            </div>
          )}
        </>
      ) : (
        <>
          {groups.map(g => shopSection(g))}

          <section className="bg-white p-4 md:rounded-md md:p-6">
            <h2 className="mb-3">付款方式</h2>
            <div className="flex flex-wrap gap-2">
              {PAYMENTS.map(p => (
                <button key={p.id} onClick={() => setPayment(p.id)}
                  className={`rounded-sm border px-4 py-2 text-sm ${payment === p.id ? 'border-brand text-brand' : 'border-line'}`}>
                  {p.label}
                </button>
              ))}
            </div>
            <dl className="mt-6 ml-auto max-w-xs space-y-2 text-sm lg:hidden">
              {summaryRows}
            </dl>
          </section>
        </>
      )}
      </div>

      {/* 桌機：右側訂單摘要卡 */}
      <aside className="sticky top-28 hidden rounded-md bg-white p-5 lg:block">
        <h2 className="font-medium">訂單摘要</h2>
        <dl className="mt-4 space-y-3 text-sm">{summaryRows}</dl>
        {submitError && <p role="alert" className="mt-3 rounded-sm bg-error-bg px-3 py-2 text-sm text-error-text">{submitError}{ownShopError && <> <Link to="/cart" className="underline">回購物車</Link></>}</p>}
        {online ? (
          <PayButton label={payingOnline ? '付款中…' : payLabel} busy={submitting} disabled={paymentLoading} onClick={() => void submit()} className="mt-4" />
        ) : (
          <button onClick={() => void submit()} disabled={submitting}
            className="mt-4 flex h-11 w-full items-center justify-center gap-2 rounded-sm bg-brand text-white transition hover:bg-brand-dark disabled:bg-disabled">
            {submitting && <Loader2 size={16} className="animate-spin" />}
            下訂單
          </button>
        )}
        {slow && <p role="status" className="mt-3 text-sm">還在處理，請不要關閉或重新整理。</p>}
      </aside>

      {/* 手機：底部固定下單列。線上付款開啟時分兩層：上層總付款（有貨到付款時右側「其中貨到付款」），下層整寬按鈕 */}
      {online ? (
        <div className="pb-safe fixed inset-x-0 bottom-0 z-30 border-t border-line bg-white px-4 pt-2 lg:hidden">
          {submitError ? (
            <p role="alert" className="text-sm text-error-text">{submitError}{ownShopError && <> <Link to="/cart" className="underline">回購物車</Link></>}</p>
          ) : slow ? (
            <p role="status" className="text-sm">還在處理，請不要關閉或重新整理。</p>
          ) : (
            <p className="flex flex-wrap items-baseline justify-between gap-x-3 text-sm">
              <span>總付款 <span className="text-lg text-brand">{money(subtotal + shipping)}</span></span>
              {!paymentLoading && plan.onlineCount > 0 && plan.cod.length > 0 && <span className="text-sm text-muted">其中貨到付款 {money(plan.codTotal)}</span>}
            </p>
          )}
          <div className="mb-2 mt-2">
            <PayButton label={payingOnline ? '付款中…' : payLabel} busy={submitting} disabled={paymentLoading} onClick={() => void submit()} />
          </div>
        </div>
      ) : (
        <div className="pb-safe fixed inset-x-0 bottom-0 z-30 flex items-center border-t border-line bg-white lg:hidden">
          <div className="flex-1 px-4">
            <p className="text-sm">總付款 <span className="text-lg text-brand">{money(subtotal + shipping)}</span></p>
            {submitError && <p role="alert" className="text-xs text-error">{submitError}{ownShopError && <> <Link to="/cart" className="underline">回購物車</Link></>}</p>}
          </div>
          <button onClick={() => void submit()} disabled={submitting}
            className="flex h-12 min-w-32 items-center justify-center gap-2 bg-brand px-6 text-white transition hover:bg-brand-dark disabled:bg-disabled">
            {submitting && <Loader2 size={16} className="animate-spin" />}
            下訂單
          </button>
        </div>
      )}

      {sheetOpen && (
        <AddressSheet
          rows={rows ?? []} selectedId={bookAddr?.bookId ?? null}
          reload={() => book.reload(true)}
          onUse={useRow} onClose={() => setSheetOpen(false)}
          onAuthLost={() => { setSheetOpen(false); if (bookAddr) askRelogin(bookAddr); }}
        />
      )}

      {bindOpen && (
        <BindSheet
          returnPath={BIND_RETURN_PATH} from="checkout" onClose={() => setBindOpen(false)}
          onBound={({ paymentMethodId }) => {
            void cardsHook.reload(true).then(() => {
              setChoice({ kind: 'card', cardId: paymentMethodId });
              setPayAnnounce('已綁定新的信用卡，已選用這張卡');
              setFocusChoice(true);
            });
            setBindOpen(false);
          }}
          onResult={(no, hint) => { saveCheckoutSnapshot(); navigate(`${BIND_RETURN_PATH}?bind=${hint}&no=${encodeURIComponent(no)}`); }}
          onBeforeRedirect={saveCheckoutSnapshot}
          onAuthLost={() => { setBindOpen(false); askRelogin(showSummary && bookAddr ? bookAddr : addressFromDraft(form.draft, saveBox)); }}
        />
      )}
    </div>
  );
}

/** 付款按鈕：維持品牌色（灰色會讓人以為壞了），處理中 aria-disabled＋aria-busy＋轉圈；用 min-h 不用 h：200% 時文字換行不被裁 */
function PayButton({ label, busy, disabled, onClick, className = '' }: { label: string; busy: boolean; disabled: boolean; onClick: () => void; className?: string }) {
  return (
    <button
      type="button" onClick={() => { if (!busy && !disabled) onClick(); }} aria-disabled={busy || disabled || undefined} aria-busy={busy || undefined}
      className={`${btnPrimary} min-h-12 w-full py-2 text-base ${pressCls} ${busy ? 'cursor-wait' : ''} ${className}`}
    >
      {busy && <Loader2 size={18} className="motion-safe:animate-spin" aria-hidden="true" />}
      {label}
    </button>
  );
}
