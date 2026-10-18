import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { ChevronRight, ClipboardList, IdCard, LoaderCircle, LogOut, MapPin, ShieldCheck, ShoppingCart, Smartphone, Store } from 'lucide-react';
import { useStore } from '../../store/StoreContext';
import LoginRequired from '../../components/auth/LoginRequired';
import { useToast } from '../../components/Toast';
import Banner from '../../components/import/Banner';
import { btnOutline } from '../../components/import/ui';
import Identity from '../../components/account/Identity';
import { sectionTitleCls } from '../../components/account/ui';
import { phoneOf } from '../../lib/auth/identity';

const ROW = 'flex min-h-12 items-center gap-3 px-4 text-sm focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-brand';

/** 帳號頁 #/account：登入方式與 email 或遮罩門號、綁定手機、我的帳戶（個人檔案、地址）、購物、賣家、隱私政策、登出（只登出這台裝置）。刪除帳號的申請方式只寫在隱私政策頁（2026-10-18 使用者決定拿掉帳號頁的區塊） */
export default function Account() {
  return (
    <LoginRequired kind="account">
      <AccountView />
    </LoginRequired>
  );
}

function AccountView() {
  const { user, signOutBuyer } = useStore();
  const navigate = useNavigate();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  // 綁定手機成功會帶著遮罩門號回到這頁：頂端橫幅（不用 toast，那句話 40 字，toast 2.6 秒讀不完），焦點移到橫幅
  const { state } = useLocation() as { state: { bound?: string } | null };
  const boundNote = typeof state?.bound === 'string' ? state.bound : null;
  const noteRef = useRef<HTMLDivElement>(null);
  useEffect(() => { if (boundNote) noteRef.current?.focus({ preventScroll: true }); }, [boundNote]);
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

  const item = (to: string, icon: ReactNode, label: string) => (
    <li><Link to={to} className={ROW}>{icon}<span className="flex-1">{label}</span><ChevronRight size={18} className="text-muted" aria-hidden="true" /></Link></li>
  );
  const group = (id: string, title: string, items: ReactNode) => (
    <>
      <h2 id={id} className={sectionTitleCls}>{title}</h2>
      <ul aria-labelledby={id} className="divide-y divide-line bg-white md:rounded-md">{items}</ul>
    </>
  );

  return (
    <div className="mx-auto max-w-2xl md:px-4 md:pt-6">
      <h1 className="px-4 py-3 text-lg font-bold md:px-0 md:pt-0">我的帳號</h1>

      {boundNote && (
        <div ref={noteRef} tabIndex={-1} className="mb-2 px-4 outline-none md:mb-3 md:px-0">
          <Banner kind="success" role="status" title={`已綁定 ${boundNote}`}>下次可以用這支手機登入同一個帳號。</Banner>
        </div>
      )}

      <section className="bg-white px-4 py-4 md:rounded-md md:px-6">
        <Identity user={user} />
      </section>

      {/* 還沒有門號的帳號才有；換號不在這一版，有門號就不顯示 */}
      {!phoneOf(user) && (
        <nav aria-label="綁定手機" className="mt-2 bg-white md:mt-3 md:rounded-md">
          <Link to="/account/phone" className={`${ROW} min-h-14 py-2`}>
            <Smartphone size={20} className="shrink-0 text-muted" aria-hidden="true" />
            <span className="flex-1">
              <span className="block font-medium">綁定手機</span>
              <span className="block text-xs leading-5 text-muted">綁定後，也能用手機號碼登入這個帳號</span>
            </span>
            <ChevronRight size={18} className="shrink-0 text-muted" aria-hidden="true" />
          </Link>
        </nav>
      )}

      {group('acct-me', '我的帳戶', <>
        {item('/account/profile', <IdCard size={20} className="shrink-0 text-muted" aria-hidden="true" />, '個人檔案')}
        {item('/account/addresses', <MapPin size={20} className="shrink-0 text-muted" aria-hidden="true" />, '地址')}
      </>)}
      {group('acct-shop', '購物', <>
        {item('/orders', <ClipboardList size={20} className="shrink-0 text-muted" aria-hidden="true" />, '我的訂單')}
        {item('/cart', <ShoppingCart size={20} className="shrink-0 text-muted" aria-hidden="true" />, '購物車')}
      </>)}
      {group('acct-seller', '賣家', item('/seller', <Store size={20} className="shrink-0 text-muted" aria-hidden="true" />, '賣家中心'))}
      {group('acct-privacy', '隱私', item('/privacy', <ShieldCheck size={20} className="shrink-0 text-muted" aria-hidden="true" />, '隱私政策'))}

      <section className="mt-5 bg-white p-4 md:mt-6 md:rounded-md md:px-6">
        <button type="button" onClick={() => void logout()} aria-disabled={busy || undefined} className={`${btnOutline} h-12 w-full text-base`}>
          {busy ? <LoaderCircle size={18} className="motion-safe:animate-spin" aria-hidden="true" /> : <LogOut size={18} aria-hidden="true" />}
          {busy ? '登出中…' : '登出'}
        </button>
        <p className="mt-3 text-xs leading-5 text-muted">只會登出這台裝置。購物車、訂單和收件地址都存在帳號裡，下次登入就會回來。</p>
      </section>
    </div>
  );
}
