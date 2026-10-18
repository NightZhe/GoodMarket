import { useCallback, useEffect, useRef, useState } from 'react';
import { TURNSTILE_SITEKEY, loadTurnstile, type TurnstileApi } from '../../lib/auth/turnstile';
import { TOKEN_WAIT_MS, tokenDecision, tsReduce, turnstileSize, type TsEvent, type TsStatus } from '../../lib/auth/turnstileState';

export type TokenResult =
  | { ok: true; /** Turnstile 沒啟用時沒有 token */ token?: string }
  | { ok: false; reason: 'interaction' | 'failed' | 'unavailable' };

export interface TurnstileCtl {
  status: TsStatus;
  /** 掛 widget 的容器（兩個地方都要有：預設不顯示任何東西） */
  hostRef: (el: HTMLDivElement | null) => void;
  /** 按下「傳送」「重新傳送」時取得這一次要用的 token：沒好就等最多 10 秒；需要互動就請使用者先勾選 */
  requestToken: () => Promise<TokenResult>;
  /** token 單次有效：呼叫 /otp 結束（成功或失敗）都要呼叫，會重設 widget 背景取新的 */
  consume: () => void;
  /** 「再試一次」「重新載入安全驗證」 */
  retry: () => void;
  /** 沒勾選就按傳送：官方 widget 的 iframe 在 closed shadow root 裡拿不到，焦點移到外層容器（tabindex=-1），再 Tab 一下進 widget */
  focus: () => void;
}

/**
 * R-15 Turnstile。Managed ＋ interaction-only：平常完全隱形，Cloudflare 判定需要互動時才長出勾選框。
 * enabled＝沒有 sitekey 或手機登入關閉時是 false，整個不載入。
 * lazy＝先不渲染 widget，等第一次 requestToken 才開始（S-10「我已經收到驗證碼」那條路不該去載入安全驗證挑戰，AC-10）。
 * token 只存在記憶體裡（R-7）：不進 URL、console、storage、toast、aria-live。
 */
export function useTurnstile({ enabled, lazy = false }: { enabled: boolean; lazy?: boolean }): TurnstileCtl {
  const on = enabled && TURNSTILE_SITEKEY !== '';
  const [status, setStatus] = useState<TsStatus>(on ? 'loading' : 'off');
  const statusRef = useRef<TsStatus>(status);
  const tokenRef = useRef<string | null>(null);
  const widgetRef = useRef<string | undefined>(undefined);
  const apiRef = useRef<TurnstileApi | null>(null);
  const waiters = useRef<(() => void)[]>([]);
  const [host, setHost] = useState<HTMLDivElement | null>(null);
  const [wanted, setWanted] = useState(!lazy);
  const [attempt, setAttempt] = useState(0);

  const fire = useCallback((e: TsEvent) => {
    const next = tsReduce(statusRef.current, e);
    statusRef.current = next;
    setStatus(next);
    if (next !== 'loading') {
      const ws = waiters.current;
      waiters.current = [];
      ws.forEach(w => w());
    }
  }, []);

  useEffect(() => {
    if (!on || !wanted || !host) return;
    let cancelled = false;
    // 腳本一直沒回來（請求卡住、不是立刻被擋）：10 秒後當作載入不了，讓使用者看得到原因與退路
    const slow = setTimeout(() => { if (!cancelled && !apiRef.current) fire({ type: 'script-failed' }); }, TOKEN_WAIT_MS);
    loadTurnstile().then(api => {
      if (cancelled) return;
      apiRef.current = api;
      widgetRef.current = api.render(host, {
        sitekey: TURNSTILE_SITEKEY,
        size: turnstileSize(host.clientWidth),
        appearance: 'interaction-only',
        theme: 'light',
        language: 'zh-tw',
        execution: 'render',
        // 用 callback 取 token，不要 widget 在 DOM 裡塞隱藏欄位
        'response-field': false,
        callback: t => { tokenRef.current = t; fire({ type: 'token' }); },
        'error-callback': () => { tokenRef.current = null; fire({ type: 'error' }); },
        'expired-callback': () => { tokenRef.current = null; fire({ type: 'expired' }); api.reset(widgetRef.current); },
        'timeout-callback': () => { tokenRef.current = null; fire({ type: 'timeout' }); },
        'before-interactive-callback': () => fire({ type: 'interactive' }),
        'after-interactive-callback': () => { /* 勾選完成後 callback 會給 token，這裡不用做事 */ },
      });
      // 腳本比 10 秒計時晚到：從「載入不了」回到載入中，token 一到就恢復
      if (statusRef.current === 'unavailable') fire({ type: 'retry' });
    }).catch(() => { if (!cancelled) fire({ type: 'script-failed' }); });
    return () => {
      cancelled = true;
      clearTimeout(slow);
      if (apiRef.current && widgetRef.current !== undefined) apiRef.current.remove(widgetRef.current);
      widgetRef.current = undefined;
      tokenRef.current = null;
    };
  }, [on, wanted, host, attempt, fire]);

  const requestToken = useCallback(async (): Promise<TokenResult> => {
    if (!on) return { ok: true };
    setWanted(true);
    let d = tokenDecision(statusRef.current);
    if (d === 'wait') {
      await new Promise<void>(resolve => {
        const timer = setTimeout(() => { fire({ type: 'stuck' }); resolve(); }, TOKEN_WAIT_MS);
        waiters.current.push(() => { clearTimeout(timer); resolve(); });
      });
      d = tokenDecision(statusRef.current);
    }
    if (d === 'send' && tokenRef.current) return { ok: true, token: tokenRef.current };
    if (d === 'send' || d === 'wait') return { ok: false, reason: 'unavailable' };
    return { ok: false, reason: d };
  }, [on, fire]);

  const consume = useCallback(() => {
    if (!on) return;
    tokenRef.current = null;
    if (apiRef.current && widgetRef.current !== undefined) {
      fire({ type: 'consumed' });
      apiRef.current.reset(widgetRef.current);
    }
  }, [on, fire]);

  const retry = useCallback(() => {
    if (!on) return;
    tokenRef.current = null;
    const wasUnavailable = statusRef.current === 'unavailable' || !apiRef.current;
    fire({ type: 'retry' });
    if (wasUnavailable) setAttempt(n => n + 1);
    else if (apiRef.current && widgetRef.current !== undefined) apiRef.current.reset(widgetRef.current);
  }, [on, fire]);

  const focus = useCallback(() => host?.focus(), [host]);

  return { status, hostRef: setHost, requestToken, consume, retry, focus };
}
