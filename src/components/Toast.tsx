import { createContext, useCallback, useContext, useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { CheckCircle2, CircleAlert, Info } from 'lucide-react';

type ToastKind = 'success' | 'error' | 'info';
// 錯誤訊息比較長、使用者需要讀完；成功只是一閃而過的回饋；info（登入已取消、已複製）字比成功多一點
const SHOW_MS: Record<ToastKind, number> = { success: 1800, error: 4000, info: 2600 };
// 比動畫多留一點，確保「減少動態效果」（沒有 animationend）時也由計時器收掉
const HIDE_GRACE_MS = 100;
const Ctx = createContext<(msg: string, kind?: ToastKind) => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<{ msg: string; kind: ToastKind; key: number } | null>(null);
  const show = useCallback((msg: string, kind: ToastKind = 'success') => setToast({ msg, kind, key: Date.now() }), []);

  // 「減少動態效果」時 toast 不播動畫，onAnimationEnd 就不會觸發；用計時器收掉，不然會一直掛在畫面上
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), SHOW_MS[toast.kind] + HIDE_GRACE_MS);
    return () => clearTimeout(t);
  }, [toast]);
  return (
    <Ctx.Provider value={show}>
      {children}
      {toast && (
        // 外層負責置中：四邊各自吃安全區（側邊姿態右緣讓開直立軌），再各留 16px；內層只做進出場動畫：兩者的 transform 不能疊在同一個元素上。
        // 不可點、不受中線帶規則限制（D13）
        <div className="pointer-events-none fixed inset-0 z-[100] flex items-center justify-center pb-[calc(env(safe-area-inset-bottom)+1rem)] pl-[calc(var(--inset-l)+1rem)] pr-[calc(var(--inset-r)+1rem)] pt-[calc(env(safe-area-inset-top)+1rem)]">
          <div
            key={toast.key}
            role={toast.kind === 'error' ? 'alert' : 'status'}
            onAnimationEnd={() => setToast(null)}
            style={{ '--toast-ms': `${SHOW_MS[toast.kind]}ms` } as CSSProperties}
            className="animate-toast flex max-w-full flex-col items-center gap-2 rounded-2xl bg-black/80 px-6 py-5 text-center text-sm text-white shadow-xl sm:max-w-sm"
          >
            {toast.kind === 'error' ? <CircleAlert size={32} strokeWidth={1.6} /> : toast.kind === 'info' ? <Info size={32} strokeWidth={1.6} /> : <CheckCircle2 size={32} strokeWidth={1.6} />}
            {toast.msg}
          </div>
        </div>
      )}
    </Ctx.Provider>
  );
}

export const useToast = () => useContext(Ctx);
