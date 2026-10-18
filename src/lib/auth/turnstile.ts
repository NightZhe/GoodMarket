// Cloudflare Turnstile 的載入（R-15）。官方 script 標籤，不裝套件、不自行代理或快取。
// sitekey 是公開值，建置時由 VITE_TURNSTILE_SITEKEY 注入：本機與預演用 Cloudflare 測試值 1x00000000000000000000AA，
// 正式值推 main 前由主對話設定。沒有 sitekey 時完全不載入——伺服器端沒開 captcha 時不帶 token 也能送。

export const TURNSTILE_SITEKEY = ((import.meta.env.VITE_TURNSTILE_SITEKEY as string | undefined) ?? '').trim();

const SCRIPT_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

export interface TurnstileRenderOptions {
  sitekey: string;
  size: 'flexible' | 'compact' | 'normal';
  appearance: 'always' | 'execute' | 'interaction-only';
  theme: 'light' | 'dark' | 'auto';
  language: string;
  execution: 'render' | 'execute';
  'response-field': boolean;
  callback: (token: string) => void;
  'error-callback': () => void;
  'expired-callback': () => void;
  'timeout-callback': () => void;
  'before-interactive-callback': () => void;
  'after-interactive-callback': () => void;
}

export interface TurnstileApi {
  render: (el: HTMLElement, opts: TurnstileRenderOptions) => string | undefined;
  reset: (widgetId?: string) => void;
  remove: (widgetId?: string) => void;
}

declare global {
  interface Window { turnstile?: TurnstileApi }
}

let loading: Promise<TurnstileApi> | null = null;

/** 載入官方腳本（只載一次）。失敗時 reject，下次呼叫會重新插入 script 標籤（「重新載入安全驗證」） */
export function loadTurnstile(): Promise<TurnstileApi> {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  loading ??= new Promise<TurnstileApi>((resolve, reject) => {
    const s = document.createElement('script');
    s.src = SCRIPT_SRC;
    s.async = true;
    s.defer = true;
    s.onload = () => {
      if (window.turnstile) resolve(window.turnstile);
      else { s.remove(); reject(new Error('turnstile missing')); }
    };
    s.onerror = () => { s.remove(); reject(new Error('turnstile blocked')); };
    document.head.appendChild(s);
  }).catch(e => { loading = null; throw e; });
  return loading;
}
