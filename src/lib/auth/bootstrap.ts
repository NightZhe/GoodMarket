import { supabase } from '../supabase';
import { parseLocation, withRoute } from './callback';
import type { BootOutcome } from './handoff';
import { browserStores, clearPending, peekPending, type PendingAction } from './pending';

// 登入回跳的啟動處理：在路由與畫面掛載之前執行。
//   1. 讀網址（?code=、錯誤參數、LINE 外開帶來的待辦動作），立刻把網址清乾淨（refresh、上一頁都不會重做）。
//   2. 有 code 就用 PKCE 換 session（detectSessionInUrl 已關，由這裡自己換，才能顯示「登入中」與處理失敗）。
//   3. 依待辦動作把 hash 路由設成要回去的那一頁——路由器是在這一切完成之後才建立的，所以不會先閃首頁。

export type { BootOutcome };

export interface BootInfo {
  /** 換 session 的結果；null＝還在換 */
  outcome: BootOutcome | null;
  /** 網址上有 code，需要顯示「登入中」 */
  exchanging: boolean;
  /** LINE 外開帶過來的待辦動作。只能預填，不會存進暫存、不會自動執行（見 handoff.ts） */
  handoff: PendingAction | null;
}

const parsed = parseLocation(window.location.pathname, window.location.search, window.location.hash, Date.now());
if (parsed.dirty) window.history.replaceState(window.history.state, '', parsed.cleanedHref);
// 網址參數帶來的動作不存進待辦暫存：連結是任何人都能散布的，只有使用者自己按了登入或確認才算數

export const bootHandoff: PendingAction | null = parsed.handoff;
export const bootNeedsExchange = parsed.callback.code !== null;
const bootFailure = parsed.callback.failure;

let outcome: BootOutcome | null = bootNeedsExchange ? null : (bootFailure ?? 'none');
let applied = false;

/** 登入結束（成功、失敗、取消）後回到發動登入的那一頁；取消時待辦動作作廢 */
function applyReturn(o: BootOutcome) {
  if (applied) return;
  applied = true;
  if (o === 'none') return;
  const rec = peekPending(browserStores(), Date.now());
  if (rec) {
    window.history.replaceState(window.history.state, '', withRoute(`${window.location.pathname}${window.location.search}`, rec.action.returnTo));
  }
  if (o === 'cancelled') clearPending(browserStores());
}

if (outcome !== null) applyReturn(outcome);

export const getBootOutcome = () => outcome;

let exchange: Promise<BootOutcome> | null = null;

/** 換 session，只會真的執行一次（React StrictMode 會重跑 effect，同一個 code 換第二次必定失敗） */
export function exchangeOnce(): Promise<BootOutcome> {
  exchange ??= (async () => {
    let result: BootOutcome = 'failed';
    try {
      const { error } = await supabase.auth.exchangeCodeForSession(parsed.callback.code as string);
      result = error ? 'failed' : 'signed_in';
    } catch {
      result = 'failed';
    }
    outcome = result;
    applyReturn(result);
    return result;
  })();
  return exchange;
}

/** 「登入中」等太久（20 秒）時使用者選擇：重新登入＝當作失敗回原頁；回首頁＝放棄待辦動作 */
export function abandonExchange(goHome: boolean): BootOutcome {
  if (goHome) {
    clearPending(browserStores());
    window.history.replaceState(window.history.state, '', withRoute(`${window.location.pathname}${window.location.search}`, '/'));
    applied = true;
    outcome = 'none';
  } else {
    outcome = 'failed';
    applyReturn('failed');
  }
  return outcome;
}
