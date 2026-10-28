import { useCallback, useEffect, useState } from 'react';
import { SIGNED_URL_TTL_S, signChatImages } from './api';

// 私有 bucket 的圖片要換簽名網址才讀得到。網址短效，所以：
//  - 模組層級快取（捲動、換頁回來不重換），存活時間比網址有效期短一截
//  - 載入失敗（網址過期）時 refresh(path) 丟掉快取、重換一次
const TTL_MS = (SIGNED_URL_TTL_S - 300) * 1000;
const cache = new Map<string, { url: string; at: number }>();

const fresh = (path: string, now: number): string | null => {
  const hit = cache.get(path);
  return hit && now - hit.at < TTL_MS ? hit.url : null;
};

export interface SignedUrls {
  /** 路徑 → 網址；還沒換到的不在裡面 */
  urls: Record<string, string>;
  /** 換網址失敗（網路）；畫面上的圖會停在載入失敗，使用者點一下再試 */
  failed: boolean;
  /** 某張圖載入失敗時呼叫：丟掉舊網址、重換 */
  refresh: (path: string) => void;
}

export function useSignedUrls(paths: string[]): SignedUrls {
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [failed, setFailed] = useState(false);
  const [bump, setBump] = useState(0);
  const key = paths.join('|');

  useEffect(() => {
    const list = key === '' ? [] : key.split('|');
    const now = Date.now();
    const have: Record<string, string> = {};
    const missing: string[] = [];
    for (const p of list) {
      const u = fresh(p, now);
      if (u) have[p] = u; else missing.push(p);
    }
    let alive = true;
    setUrls(have);
    if (missing.length === 0) { setFailed(false); return; }
    void signChatImages(missing).then(got => {
      if (!alive) return;
      const at = Date.now();
      for (const [p, url] of Object.entries(got)) cache.set(p, { url, at });
      setUrls({ ...have, ...got });
      setFailed(Object.keys(got).length < missing.length);
    }, () => { if (alive) setFailed(true); });
    return () => { alive = false; };
  }, [key, bump]);

  const refresh = useCallback((path: string) => {
    cache.delete(path);
    setBump(n => n + 1);
  }, []);

  return { urls, failed, refresh };
}
