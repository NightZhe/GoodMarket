import { useEffect, useRef, useState } from 'react';
import LeaveDialog from '../../components/import/LeaveDialog';
import { useToast } from '../../components/Toast';
import { SubHeader, SubPage } from '../../components/account/ui';
import { useStore } from '../../store/StoreContext';
import { useAuth } from '../../store/AuthContext';
import { cancelDeletion, requestDeletion } from '../../lib/deletion/api';
import { confirmApplyText } from '../../lib/deletion/copy';
import { failureOf, hasShopOf, stageOf } from '../../lib/deletion/status';
import { useDeletionStatus } from '../../lib/deletion/useDeletionStatus';
import { useOnline } from '../../lib/useOnline';
import { AccountDeleteView } from './AccountDeleteView';

type Dialog = 'apply' | 'cancel' | null;
type FocusWish = 'status' | 'title' | null;

/** 刪除帳號申請 #/account/delete。未登入也看得到說明（不包 LoginRequired），登入鈕在頁內 */
export default function AccountDelete() {
  const { user, authReady, sessionExpired } = useStore();
  const { openLogin } = useAuth();
  const toast = useToast();
  const online = useOnline();
  const { view, reload, setView } = useDeletionStatus(authReady && user ? user.id : null);
  // 送出／取消時資料庫說登入失效，但 store 還沒發現（user 還在）
  const [authLost, setAuthLost] = useState(false);
  // 剛送出成功：狀態卡標題用「已收到你的刪除申請」；再次進頁是「刪除申請處理中」
  const [justSubmitted, setJustSubmitted] = useState(false);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [busy, setBusy] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [focusWish, setFocusWish] = useState<FocusWish>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const statusRef = useRef<HTMLHeadingElement>(null);

  // 重新登入完成（user 換了新物件）：清掉登入失效旗標、重讀狀態。第一次 render 不算
  const authLostRef = useRef(false);
  authLostRef.current = authLost;
  const firstUser = useRef(true);
  useEffect(() => {
    if (firstUser.current) { firstUser.current = false; return; }
    if (!user || !authLostRef.current) return;
    setAuthLost(false);
    void reload('full');
  }, [user, reload]);

  // 焦點在對話框卸載「之後」才移：LeaveDialog 的清理會把焦點還給已不存在的元素
  useEffect(() => {
    if (!focusWish || dialog !== null) return;
    // 狀態卡在頁面最上方：先捲到頂再聚焦（focus() 的最小捲動會把標題停在黏頂頁首底下，看不到；小q 驗收發現）
    if (focusWish === 'status') { window.scrollTo({ top: 0 }); statusRef.current?.focus({ preventScroll: true }); }
    else titleRef.current?.focus();
    setFocusWish(null);
  }, [focusWish, dialog, view]);

  const stage = stageOf({ authReady, signedIn: user !== null, sessionExpired, authLost, view });
  const hasShop = hasShopOf(view);

  const login = () => {
    if (!online) { toast('連上網路後才能登入', 'info'); return; }
    openLogin();
  };

  const retry = async () => {
    setRetrying(true);
    await reload('keep');
    setRetrying(false);
  };

  const fail = (action: 'request' | 'cancel', e: unknown) => {
    const f = failureOf(action, e);
    if (f.toast) toast(f.toast.message, f.toast.kind);
    if (f.next === 'auth') setAuthLost(true);
    else if (f.next === 'backend_missing') setView({ kind: 'backend_missing' });
    else void reload('silent');
  };

  const apply = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const request = await requestDeletion();
      setView({ kind: 'pending', request, hasShop });
      setJustSubmitted(true);
      setDialog(null);
      setFocusWish('status');
    } catch (e) {
      setDialog(null);
      fail('request', e);
    } finally {
      setBusy(false);
    }
  };

  const cancel = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await cancelDeletion();
      toast('已取消刪除申請');
      // 先回到可申請，再靜默重讀：取消期間若又有未完成訂單，重讀後會換成擋訂單的畫面
      setView({ kind: 'can_apply', hasShop });
      setJustSubmitted(false);
      setDialog(null);
      setFocusWish('title');
      void reload('silent');
    } catch (e) {
      setDialog(null);
      fail('cancel', e);
    } finally {
      setBusy(false);
    }
  };

  const askApply = () => {
    if (!online) { toast('連上網路後才能申請', 'info'); return; }
    setDialog('apply');
  };
  const askCancel = () => {
    if (!online) { toast('連上網路後才能取消申請', 'info'); return; }
    setDialog('cancel');
  };

  return (
    <SubPage>
      <SubHeader to="/account" backLabel="回到我的帳號" title="刪除帳號" titleRef={titleRef} />
      <AccountDeleteView
        stage={stage} view={view} online={online} retrying={retrying} justSubmitted={justSubmitted} statusRef={statusRef}
        onLogin={login} onRetry={() => void retry()} onApply={askApply} onAskCancel={askCancel}
      />
      {dialog === 'apply' && (
        <LeaveDialog
          title="確定要申請刪除帳號？" description={confirmApplyText(hasShop)}
          stayLabel="取消" leaveLabel="申請刪除" busy={busy} busyLabel="送出中…"
          offlineNotice={online ? undefined : '連上網路後才能申請。'}
          onStay={() => setDialog(null)} onLeave={() => void apply()}
        />
      )}
      {dialog === 'cancel' && (
        <LeaveDialog
          title="取消刪除申請？" description="你的帳號會保留。" leaveTone="primary"
          stayLabel="保留申請" leaveLabel="取消申請" busy={busy} busyLabel="取消中…"
          offlineNotice={online ? undefined : '連上網路後才能取消申請。'}
          onStay={() => setDialog(null)} onLeave={() => void cancel()}
        />
      )}
    </SubPage>
  );
}
