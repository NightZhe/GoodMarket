import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ChevronRight, ClipboardList, LoaderCircle, LogOut, ShieldCheck, ShoppingCart, Store, UserRound } from 'lucide-react';
import { useStore } from '../../store/StoreContext';
import LoginRequired from '../../components/auth/LoginRequired';
import { useToast } from '../../components/Toast';
import { btnOutline } from '../../components/import/ui';
import { accountLabel, loginProviderOf, providerLabel } from '../../lib/auth/identity';

const ROW = 'flex min-h-12 items-center gap-3 px-4 text-sm focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-brand';

/** 帳號頁 #/account：登入方式與 email、登出（只登出這台裝置）、隱私政策。刪除帳號的申請方式只寫在隱私政策頁（2026-10-18 使用者決定拿掉帳號頁的區塊） */
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
  if (!user) return null;

  const provider = loginProviderOf(user);
  const label = accountLabel(user);

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
    <div className="mx-auto max-w-2xl md:px-4 md:pt-6">
      <h1 className="px-4 py-3 text-lg font-bold md:px-0 md:pt-0">我的帳號</h1>

      <section className="bg-white px-4 py-4 md:rounded-md md:px-6">
        <div className="flex items-center gap-3">
          {/* 不顯示 Google 大頭貼：R-13 帳號資訊不外露，也跟 Apple（拿不到頭像）一致 */}
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-canvas text-muted" aria-hidden="true"><UserRound size={24} /></span>
          <div className="min-w-0">
            <p className="font-medium">{provider === 'google' || provider === 'apple' ? `使用 ${providerLabel(provider)} 登入中` : '已登入'}</p>
            <p className="break-all text-sm text-muted">{label}</p>
          </div>
        </div>
      </section>

      <nav aria-label="帳號捷徑" className="mt-2 divide-y divide-line bg-white md:mt-3 md:rounded-md">
        <Link to="/orders" className={ROW}><ClipboardList size={20} className="text-muted" aria-hidden="true" /><span className="flex-1">我的訂單</span><ChevronRight size={18} className="text-muted" aria-hidden="true" /></Link>
        <Link to="/cart" className={ROW}><ShoppingCart size={20} className="text-muted" aria-hidden="true" /><span className="flex-1">購物車</span><ChevronRight size={18} className="text-muted" aria-hidden="true" /></Link>
        <Link to="/seller" className={ROW}><Store size={20} className="text-muted" aria-hidden="true" /><span className="flex-1">賣家中心</span><ChevronRight size={18} className="text-muted" aria-hidden="true" /></Link>
      </nav>

      <section className="mt-2 bg-white p-4 md:mt-3 md:rounded-md md:px-6">
        <button type="button" onClick={() => void logout()} aria-disabled={busy || undefined} className={`${btnOutline} h-12 w-full text-base`}>
          {busy ? <LoaderCircle size={18} className="motion-safe:animate-spin" aria-hidden="true" /> : <LogOut size={18} aria-hidden="true" />}
          {busy ? '登出中…' : '登出'}
        </button>
        <p className="mt-3 text-xs leading-5 text-muted">只會登出這台裝置。購物車和訂單會保留在帳號裡，下次登入就會回來；這台裝置記住的收件資料會一併清除。</p>
      </section>

      <nav aria-label="政策" className="mt-2 bg-white md:mt-3 md:rounded-md">
        <Link to="/privacy" className={ROW}><ShieldCheck size={20} className="text-muted" aria-hidden="true" /><span className="flex-1">隱私政策</span><ChevronRight size={18} className="text-muted" aria-hidden="true" /></Link>
      </nav>
    </div>
  );
}
