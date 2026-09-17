import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import { CheckCircle2 } from 'lucide-react';

const Ctx = createContext<(msg: string) => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<{ msg: string; key: number } | null>(null);
  const show = useCallback((msg: string) => setToast({ msg, key: Date.now() }), []);
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
