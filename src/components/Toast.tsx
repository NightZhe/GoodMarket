import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { CheckCircle2 } from 'lucide-react';

const Ctx = createContext<(msg: string) => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<{ msg: string; key: number } | null>(null);
  const show = useCallback((msg: string) => setToast({ msg, key: Date.now() }), []);

  // 「減少動態效果」時 toast 不播動畫，onAnimationEnd 就不會觸發；用計時器收掉，不然會一直掛在畫面上
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 1900);
    return () => clearTimeout(t);
  }, [toast]);
  return (
    <Ctx.Provider value={show}>
      {children}
      {toast && (
        <div
          key={toast.key}
          role="status"
          onAnimationEnd={() => setToast(null)}
          className="animate-toast fixed left-1/2 top-1/2 z-[100] flex -translate-x-1/2 flex-col items-center gap-2 rounded-2xl bg-black/80 px-6 py-5 text-sm text-white shadow-xl"
        >
          <CheckCircle2 size={32} strokeWidth={1.6} />
          {toast.msg}
        </div>
      )}
    </Ctx.Provider>
  );
}

export const useToast = () => useContext(Ctx);
