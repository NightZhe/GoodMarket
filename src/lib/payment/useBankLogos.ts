import { useEffect, useState } from 'react';
import { fetchBankLogosEnabled } from './api';

// logo 的伺服器端總開關（改資料庫即生效，App 不必重送審）。讀到之前、讀不到都當作關：畫面先是純文字，開關開著才補上 logo。
// 結果在記憶體裡快取 60 秒，頁面之間切換不會每次都重問。

const FRESH_MS = 60_000;
let cache: { enabled: boolean; at: number } | null = null;
let inflight: Promise<boolean> | null = null;

function load(): Promise<boolean> {
  inflight ??= fetchBankLogosEnabled()
    .then(enabled => { cache = { enabled, at: Date.now() }; return enabled; })
    .finally(() => { inflight = null; });
  return inflight;
}

export function useBankLogosEnabled(): boolean {
  const [enabled, setEnabled] = useState(() => cache?.enabled ?? false);
  useEffect(() => {
    let alive = true;
    if (cache && Date.now() - cache.at < FRESH_MS) return;
    void load().then(v => { if (alive) setEnabled(v); });
    return () => { alive = false; };
  }, []);
  return enabled;
}
