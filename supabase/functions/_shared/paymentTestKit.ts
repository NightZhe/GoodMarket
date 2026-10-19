// 測試用：記憶體版的 PaymentStore 與可編排的假 Gateway。
import type { AuthRow } from './paymentTypes.ts';
import type { Gateway, PaymentStore, FailureInfo } from './paymentRunner.ts';
import type { AuthorizeResult, ActionResult, Inquiry } from './ecpayClient.ts';

export function memoryStore(auths: AuthRow[], decision: 'capture' | 'abandon' | null = null) {
  const rows = new Map(auths.map((a) => [a.id, { ...a }]));
  const st = {
    decision, status: 'processing' as string, failure: null as FailureInfo | null, confirmReason: null as string | null,
    finalized: [] as string[], setDecisionCalls: 0,
  };
  const store: PaymentStore = {
    async listAuths() { return [...rows.values()].map((r) => ({ ...r })); },
    async getDecision() { return st.decision; },
    async setDecision(_g, d) { st.decision = d; st.setDecisionCalls++; },
    async markCalling(id, now) { const r = rows.get(id)!; r.state = 'calling'; r.callStartedAt = now; },
    async saveAuth(id, patch) { Object.assign(rows.get(id)!, patch); },
    async finalizePaid() { st.status = 'paid'; st.finalized.push('paid'); },
    async finalizeAttemptFailed(_g, f) { st.status = 'pending'; st.failure = f; st.finalized.push('failed'); },
    async setConfirming(_g, reason) { st.status = 'confirming'; st.confirmReason = reason; },
  };
  return { store, rows, st };
}

export interface Script {
  authorize?: Record<string, AuthorizeResult | (() => AuthorizeResult)>;   // key＝merchantId
  inquire?: Record<string, Inquiry | (() => Inquiry)>;
  capture?: Record<string, ActionResult | (() => ActionResult)>;
  abandon?: Record<string, ActionResult | (() => ActionResult)>;
}
const pick = <T>(v: T | (() => T) | undefined, dflt: T): T => (typeof v === 'function' ? (v as () => T)() : v ?? dflt);

export function fakeGateway(script: Script = {}) {
  const log: string[] = [];
  const g: Gateway = {
    async authorize(a) { log.push(`authorize:${a.merchantId}`); return pick(script.authorize?.[a.merchantId], { kind: 'authorized', tradeNo: 'E-' + a.merchantTradeNo, card6: '431195', card4: '2222' } as AuthorizeResult); },
    async inquire(a) { log.push(`inquire:${a.merchantId}`); return pick(script.inquire?.[a.merchantId], { kind: 'unknown' } as Inquiry); },
    async capture(a) { log.push(`capture:${a.merchantId}`); return pick(script.capture?.[a.merchantId], { kind: 'done' } as ActionResult); },
    async abandon(a) { log.push(`abandon:${a.merchantId}`); return pick(script.abandon?.[a.merchantId], { kind: 'done' } as ActionResult); },
  };
  return { g, log };
}
