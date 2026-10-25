import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { CircleAlert, CircleCheck, CircleDashed, Clock, LoaderCircle } from 'lucide-react';
import { useStore } from '../../store/StoreContext';
import { useAuth } from '../../store/AuthContext';
import { useToast } from '../../components/Toast';
import Banner from '../../components/import/Banner';
import Identity from '../../components/account/Identity';
import { Group, NavRow, ROW, ROW_IN, SignedOut } from '../../components/account/AccountRows';
import { clearGoto, rememberGoto, takeGoto } from '../../components/account/loginGoto';
import { browserStores } from '../../lib/auth/pending';
import { phoneOf } from '../../lib/auth/identity';
import { MERCHANT_STATE_TEXT, type MerchantState } from '../../lib/payment/merchant';
import { usePaymentConfig } from '../../lib/payment/usePaymentConfig';
import { useMerchantState } from '../../lib/payment/useMerchant';
import { useOnline } from '../../lib/useOnline';

const BADGE: Record<MerchantState, { Icon: typeof Clock; tone: string }> = {
  none: { Icon: CircleDashed, tone: 'text-ink' },
  review: { Icon: Clock, tone: 'text-info-text' },
  active: { Icon: CircleCheck, tone: 'text-success-text' },
  rejected: { Icon: CircleAlert, tone: 'text-error-text' },
  suspended: { Icon: CircleAlert, tone: 'text-error-text' },
};

function MerchantBadge({ state }: { state: MerchantState }) {
  const { Icon, tone } = BADGE[state];
  return <span className={`inline-flex items-center gap-1 text-sm ${tone}`}><Icon size={14} aria-hidden="true" />{MERCHANT_STATE_TEXT[state].title}</span>;
}

const store = () => browserStores()[0] ?? null;

/**
 * 「我的」#/account。頁首的大標題「我的」（h1）由 BuyerLayout 放，這裡不再放 h1。
 * 沒登入也有頁面（登入入口＋購物、開店、其他）；登入後是帳號列表。登入狀態還不知道（authReady 前）時列表照樣顯示，頭像位置放灰塊。
 * 刪除帳號的申請方式只寫在隱私政策頁（2026-10-18 使用者決定拿掉帳號頁的區塊）
 */
export default function Account() {
  const { user, authReady } = useStore();
  const { openLogin, panel } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const online = useOnline();
  // 未登入時按「我的訂單／購物車／地址」想去的頁。Google／Apple 登入會整頁轉址，所以同時存 sessionStorage（見 loginGoto）；這個 ref 是儲存被擋時的備案
  const gotoRef = useRef<string | null>(null);

  // 登入完成就到剛才想去的頁。晚一拍：Google／Apple 轉址回來時 PendingRunner 會先把頁面「回到 /account」，我們要排在它後面
  useEffect(() => {
    if (!authReady || !user) return;
    const t = setTimeout(() => {
      const s = store();
      const to = (s ? takeGoto(s, Date.now()) : null) ?? gotoRef.current;
      gotoRef.current = null;
      if (to) navigate(to);
    }, 0);
    return () => clearTimeout(t);
  }, [authReady, user, navigate]);

  // 面板關了、人還是沒登入＝取消：留在這頁，不導頁、不顯示錯誤
  useEffect(() => {
    if (!authReady || user || panel) return;
    gotoRef.current = null;
    const s = store();
    if (s) clearGoto(s);
  }, [authReady, user, panel]);

  /** to＝登入後要去的頁；null＝只是登入，留在這頁 */
  const login = (to: string | null) => {
    if (!online) { toast('連上網路後才能登入', 'info'); return; }
    if (to) {
      gotoRef.current = to;
      const s = store();
      if (s) rememberGoto(s, to, Date.now());
    }
    openLogin();
  };

  return (
    <div className="min-h-dvh bg-canvas">
      <div className="mx-auto max-w-2xl pb-8 pt-5">
        {user ? <SignedIn /> : <SignedOut known={authReady} onLogin={login} />}
      </div>
    </div>
  );
}

function SignedIn() {
  const { user, signOutBuyer, myShop } = useStore();
  // 線上付款開關關著時，「付款方式」「收款帳戶」兩個入口都不出現
  const { enabled: payEnabled } = usePaymentConfig();
  const merchantState = useMerchantState(payEnabled && myShop !== null);
  const { providers } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  // 綁定手機成功會帶著遮罩門號回到這頁：頂端橫幅（不用 toast，那句話 40 字，toast 2.6 秒讀不完），焦點移到橫幅
  const { state } = useLocation() as { state: { bound?: string } | null };
  // 只顯示一次：進來時記下，然後把導航 state 清掉，重新整理就不會再出現
  const [boundNote] = useState(() => (typeof state?.bound === 'string' ? state.bound : null));
  const noteRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!boundNote) return;
    noteRef.current?.focus({ preventScroll: true });
    navigate('/account', { replace: true, state: null });
  }, [boundNote, navigate]);
  if (!user) return null;

  const logout = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await signOutBuyer();
      navigate('/', { replace: true });
      toast('已登出');
    } catch {
      // 仍維持登入：沒有網路時伺服器那一端登不出去，不能假裝成功
      toast('登出失敗，請檢查網路後再試', 'error');
      setBusy(false);
    }
  };

  return (
    <>
      {boundNote && (
        <div ref={noteRef} tabIndex={-1} className="mx-4 mb-6 outline-none">
          <Banner kind="success" role="status" title={`已綁定 ${boundNote}`}>下次可以用這支手機登入同一個帳號。</Banner>
        </div>
      )}

      <section className="mx-4 rounded-card bg-white p-4">
        <Identity user={user} />
      </section>

      {/* 還沒有門號的帳號才有；換號不在這一版，有門號就不顯示 */}
      {!phoneOf(user) && providers.phone && (
        <Group>
          <NavRow to="/account/phone" label="綁定手機">
            <span className="min-w-0 flex-1">
              <span className="block">綁定手機</span>
              <span className="block text-footnote text-muted">綁定後，也能用手機號碼登入這個帳號</span>
            </span>
          </NavRow>
        </Group>
      )}

      <Group id="acct-me" title="我的帳戶">
        <NavRow to="/account/profile" label="個人檔案" />
        {payEnabled && <NavRow to="/account/payment-methods" label="付款方式" />}
        <NavRow to="/account/addresses" label="地址" />
      </Group>
      <Group id="acct-shop" title="購物">
        <NavRow to="/orders" label="我的訂單" />
        <NavRow to="/cart" label="購物車" />
      </Group>
      <Group id="acct-seller" title="賣家">
        <NavRow to="/seller" label="賣家中心" />
        {payEnabled && myShop && (
          <NavRow to="/account/payout" label="收款帳戶">
            {/* 狀態文字與圖示一起顯示（不只靠顏色）；200% 時狀態換到標籤下面。還沒讀到狀態就不顯示 */}
            <span className="flex min-w-0 flex-1 flex-wrap items-center justify-between gap-x-3 gap-y-0.5">
              <span>收款帳戶</span>
              {merchantState && <MerchantBadge state={merchantState} />}
            </span>
          </NavRow>
        )}
      </Group>
      <Group id="acct-privacy" title="隱私">
        <NavRow to="/privacy" label="隱私政策" />
      </Group>

      <Group footer="只會登出這台裝置。購物車、訂單和收件地址都存在帳號裡，下次登入就會回來。">
        <li>
          <button type="button" onClick={() => void logout()} aria-disabled={busy || undefined} className={`${ROW} justify-center pl-0 text-brand`}>
            <span data-row="" className={`${ROW_IN} justify-center pl-3`}>
              {busy && <LoaderCircle size={18} className="motion-safe:animate-spin" aria-hidden="true" />}
              {busy ? '登出中…' : '登出'}
            </span>
          </button>
        </li>
      </Group>
    </>
  );
}
