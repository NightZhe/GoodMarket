import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import {
  abandonExchange, bootHandoff, bootNeedsExchange, exchangeOnce, getBootOutcome, type BootInfo, type BootOutcome,
} from '../../lib/auth/bootstrap';
import AuthStatusScreen, { type StatusPhase } from './AuthStatusScreen';

const SLOW_MS = 8_000;
const TIMEOUT_MS = 20_000;

const BootCtx = createContext<BootInfo>({ outcome: 'none', exchanging: false, handoff: null });
export const useBoot = () => useContext(BootCtx);

/**
 * 最外層：網址帶 ?code= 時，先把 session 換好、把 hash 路由設成要回去的那一頁，才讓整個 App（含路由器）掛載。
 * 沒有 code 的一般開站完全不經過這裡的等待。
 */
export default function AuthBoot({ children }: { children: ReactNode }) {
  const [outcome, setOutcome] = useState<BootOutcome | null>(() => getBootOutcome());
  const [phase, setPhase] = useState<StatusPhase>('working');

  useEffect(() => {
    if (outcome !== null) return;
    let alive = true;
    void exchangeOnce().then(o => { if (alive) setOutcome(o); });
    const slow = setTimeout(() => { if (alive) setPhase(p => (p === 'working' ? 'slow' : p)); }, SLOW_MS);
    const late = setTimeout(() => { if (alive) setPhase('timeout'); }, TIMEOUT_MS);
    return () => { alive = false; clearTimeout(slow); clearTimeout(late); };
  }, [outcome]);

  if (outcome === null) {
    return (
      <AuthStatusScreen
        phase={phase}
        onRetry={() => setOutcome(abandonExchange(false))}
        onHome={() => setOutcome(abandonExchange(true))}
      />
    );
  }
  return (
    <BootCtx.Provider value={{ outcome, exchanging: bootNeedsExchange, handoff: bootHandoff }}>
      {children}
    </BootCtx.Provider>
  );
}
