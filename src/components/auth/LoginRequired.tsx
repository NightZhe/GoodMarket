import { useRef, type ReactNode } from 'react';
import { useStore } from '../../store/StoreContext';
import AuthGate, { type GateKind } from './AuthGate';

/**
 * 要先登入才看得到的頁面。登入狀態還在判斷時顯示骨架，不閃出登入畫面（已登入的人不該看到一瞬間的閘門）。
 * sticky：這個畫面上有使用者填到一半的東西（結帳頁）——登入過期時不能把頁面換掉，
 * 否則收件資料、付款方式會跟著消失；改由呼叫端開登入面板蓋在上面。
 */
export default function LoginRequired({ kind, sticky = false, children }: { kind: GateKind; sticky?: boolean; children: ReactNode }) {
  const { authReady, user, sessionExpired } = useStore();
  const everSignedIn = useRef(false);
  if (user) everSignedIn.current = true;

  if (!authReady) {
    return (
      <div aria-busy="true" className="mx-auto max-w-md px-4 py-12">
        <p role="status" className="sr-only">載入中</p>
        <div className="space-y-3" aria-hidden="true">
          <div className="mx-auto h-14 w-14 rounded-full bg-line motion-safe:animate-pulse" />
          <div className="mx-auto h-5 w-40 rounded-sm bg-line motion-safe:animate-pulse" />
        </div>
      </div>
    );
  }
  if (!user && !(sticky && everSignedIn.current)) return <AuthGate kind={kind} expired={sessionExpired} />;
  return <>{children}</>;
}
