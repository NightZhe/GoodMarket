import { useState, type ReactNode } from 'react';
import { useStore } from '../../store/StoreContext';
import { useAuth } from '../../store/AuthContext';
import ReportSheet, { type ReportTarget } from './ReportSheet';

/**
 * 檢舉入口的共用流程（S-K7）：未登入 → 開登入面板（取消回原頁，登入後不自動開抽屜、不送）；已登入 → 開抽屜。
 * 一個頁面只持有一個 target，只渲染一個 ReportSheet。
 */
export function useReport(opts: { onBlockShop?: () => void } = {}): { open: (target: ReportTarget) => void; sheet: ReactNode } {
  const { user } = useStore();
  const { openLogin } = useAuth();
  const [target, setTarget] = useState<ReportTarget | null>(null);
  const open = (t: ReportTarget) => {
    if (!user) { openLogin(); return; }
    setTarget(t);
  };
  const sheet = target
    ? <ReportSheet key={`${target.type}-${target.id}`} target={target} onClose={() => setTarget(null)} onBlockShop={opts.onBlockShop} />
    : null;
  return { open, sheet };
}
