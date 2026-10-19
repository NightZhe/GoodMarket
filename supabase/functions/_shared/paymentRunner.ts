// 執行端：反覆「規劃 → 執行一步 → 把結果寫回 → 再規劃」，直到收尾或必須等待。
// 結帳付款（payment-pay）與補償（payment-status / payment-sweep）呼叫的是同一個 driveGroup，
// 差別只在 allowAuthorize：補償時沒有卡片情境，不准發出新的授權。
import { planStep } from './paymentPlanner.ts';
import { NO_AUTH_CONFIRM_MS, type AuthRow, type GroupDecision, type PlanStep } from './paymentTypes.ts';
import type { AuthorizeResult, ActionResult, Inquiry } from './ecpayClient.ts';
import { userMessageForDecline } from './ecpayCodes.ts';

export interface Gateway {
  authorize(a: { merchantId: string; merchantTradeNo: string; amount: number; bindCardId: string; memberId: string; itemName: string; buyerEmail?: string; tradeDate: string }): Promise<AuthorizeResult>;
  inquire(a: { merchantId: string; merchantTradeNo: string }): Promise<Inquiry>;
  capture(a: { merchantId: string; merchantTradeNo: string; amount: number }): Promise<ActionResult>;
  abandon(a: { merchantId: string; merchantTradeNo: string; amount: number }): Promise<ActionResult>;
}

export interface FailureInfo {
  shopId: string | null;
  orderId: string | null;
  rtnCode: number | null;
  message: string;           // 給買家看的中文
  cardInvalid: boolean;      // 卡片失效：前端提示刪卡換卡
}

/** 資料庫那一側。每個方法必須是單一原子寫入（比較並設定），driveGroup 才能在行程隨時中斷下仍可重入。 */
export interface PaymentStore {
  listAuths(groupId: string): Promise<AuthRow[]>;                       // 目前這次嘗試的所有授權
  getDecision(groupId: string): Promise<GroupDecision>;
  setDecision(groupId: string, d: 'capture' | 'abandon'): Promise<void>;
  markCalling(authId: string, nowMs: number): Promise<void>;           // 寫入意圖（write-ahead）：打綠界「之前」呼叫
  saveAuth(authId: string, patch: Partial<AuthRow>): Promise<void>;
  finalizePaid(groupId: string): Promise<void>;                         // 訂單轉已付款（一個交易）
  finalizeAttemptFailed(groupId: string, failure: FailureInfo): Promise<void>; // 這次嘗試失敗，群組回到可重付
  setConfirming(groupId: string, reason: string): Promise<void>;       // 放掉租約，交給補償
}

export interface AuthorizeCtx { bindCardId: string; memberId: string; buyerEmail?: string; itemName: string; tradeDate: string }

export interface DriveDeps { store: PaymentStore; gateway: Gateway; now: () => number }
export interface DriveOpts { allowAuthorize: boolean; authorizeCtx?: AuthorizeCtx }

export type DriveResult =
  | { outcome: 'paid' }
  | { outcome: 'failed'; failure: FailureInfo }
  | { outcome: 'confirming'; reason: string };

const MAX_STEPS = 16;
const PARALLEL = 5;

async function inChunks<T>(items: T[], fn: (x: T) => Promise<void>): Promise<void> {
  for (let i = 0; i < items.length; i += PARALLEL) await Promise.all(items.slice(i, i + PARALLEL).map(fn));
}

const signature = (decision: GroupDecision, auths: AuthRow[]) =>
  JSON.stringify([decision, auths.map((a) => [a.id, a.state, a.actionFailures, a.ecpayTradeNo])]);

function failureFrom(auths: AuthRow[]): FailureInfo {
  const d = auths.find((a) => a.state === 'declined' && !a.resolvedByQuery) ?? auths.find((a) => a.state === 'declined');
  if (!d) return { shopId: null, orderId: null, rtnCode: null, message: userMessageForDecline(null), cardInvalid: false };
  const cardInvalid = d.rtnCode === 10100251 || d.rtnCode === 10100255 || d.rtnCode === 10100256;
  return { shopId: d.shopId, orderId: d.orderId, rtnCode: d.rtnCode, message: userMessageForDecline(d.rtnCode), cardInvalid };
}

export async function driveGroup(deps: DriveDeps, groupId: string, opts: DriveOpts): Promise<DriveResult> {
  const { store, gateway, now } = deps;
  let lastSig = '';
  for (let i = 0; i < MAX_STEPS; i++) {
    const auths = await store.listAuths(groupId);
    const decision = await store.getDecision(groupId);
    let step: PlanStep = planStep({ id: groupId, decision }, auths, now());

    // 補償程序不准發新授權：還沒打過綠界的 pending，這次嘗試直接作廢（買家可以重新付款）
    if (step.type === 'authorize' && (!opts.allowAuthorize || !opts.authorizeCtx)) step = { type: 'decide', decision: 'abandon' };

    switch (step.type) {
      case 'finalize':
        if (step.outcome === 'paid') { await store.finalizePaid(groupId); return { outcome: 'paid' }; }
        { const failure = failureFrom(auths); await store.finalizeAttemptFailed(groupId, failure); return { outcome: 'failed', failure }; }
      case 'wait':
        await store.setConfirming(groupId, step.reason);
        return { outcome: 'confirming', reason: step.reason };
      case 'decide':
        // 請款改放棄：關帳失敗的次數不能算進放棄的額度，否則一開始就會被判「卡住」
        if (decision === 'capture' && step.decision === 'abandon') for (const a of auths) if (a.actionFailures > 0) await store.saveAuth(a.id, { actionFailures: 0 });
        await store.setDecision(groupId, step.decision);
        break;
      case 'skip': for (const a of step.auths) await store.saveAuth(a.id, { state: 'abandoned' }); break;
      case 'authorize': {
        const ctx = opts.authorizeCtx!;
        await inChunks(step.auths, async (a) => {
          await store.markCalling(a.id, now());   // write-ahead：先記下「要打了」，行程死在這之後也找得回來
          const r = await gateway.authorize({ merchantId: a.merchantId, merchantTradeNo: a.merchantTradeNo, amount: a.amount, ...ctx });
          if (r.kind === 'authorized') await store.saveAuth(a.id, { state: 'authorized', ecpayTradeNo: r.tradeNo, rtnCode: 1 });
          else if (r.kind === 'declined') await store.saveAuth(a.id, { state: 'declined', rtnCode: r.rtnCode, rtnMsg: r.rtnMsg });
          else await store.saveAuth(a.id, { rtnMsg: r.reason }); // 維持 calling，交給補償查詢
        });
        break;
      }
      case 'refresh':
        await inChunks(step.auths, async (a) => {
          const q = await gateway.inquire({ merchantId: a.merchantId, merchantTradeNo: a.merchantTradeNo });
          if (q.kind === 'unknown') return;
          if (q.kind === 'none') {
            // 綠界沒有這筆。銀行慢回的授權可能晚到，所以滿 10 分鐘才確定它不會出現
            if (a.callStartedAt != null && now() - a.callStartedAt >= NO_AUTH_CONFIRM_MS) await store.saveAuth(a.id, { state: 'declined', resolvedByQuery: true, rtnMsg: 'no authorization found' });
            return;
          }
          if (q.status === 'authorized') await store.saveAuth(a.id, { state: 'authorized', ecpayTradeNo: q.tradeNo, rtnCode: 1 });
          else if (q.status === 'to_capture' || q.status === 'captured') await store.saveAuth(a.id, { state: 'captured', ecpayTradeNo: q.tradeNo, rtnCode: 1 });
          else if (q.status === 'cancelled' || q.status === 'unauthorized') await store.saveAuth(a.id, { state: 'declined', resolvedByQuery: true, ecpayTradeNo: q.tradeNo });
          else await store.saveAuth(a.id, { state: 'authorized', ecpayTradeNo: q.tradeNo, rtnCode: 1 }); // op_canceled：回到已授權
        });
        break;
      case 'capture':
        await inChunks(step.auths, async (a) => {
          const r = await gateway.capture({ merchantId: a.merchantId, merchantTradeNo: a.merchantTradeNo, amount: a.amount });
          if (r.kind === 'done') await store.saveAuth(a.id, { state: 'captured' });
          else if (r.kind === 'failed') await store.saveAuth(a.id, { actionFailures: a.actionFailures + 1, rtnMsg: r.rtnMsg });
        });
        break;
      case 'abandon':
        await inChunks(step.auths, async (a) => {
          const r = await gateway.abandon({ merchantId: a.merchantId, merchantTradeNo: a.merchantTradeNo, amount: a.amount });
          if (r.kind === 'done') await store.saveAuth(a.id, { state: 'abandoned' });
          else if (r.kind === 'failed') await store.saveAuth(a.id, { actionFailures: a.actionFailures + 1, rtnMsg: r.rtnMsg });
        });
        break;
    }

    // 沒有任何進展（例如綠界查詢／動作都回「不明」）→ 不空轉，交給下一輪補償
    if (step.type === 'refresh' || step.type === 'capture' || step.type === 'abandon') {
      const sig = signature(await store.getDecision(groupId), await store.listAuths(groupId));
      if (sig === signature(decision, auths) || sig === lastSig) {
        await store.setConfirming(groupId, 'no_progress');
        return { outcome: 'confirming', reason: 'no_progress' };
      }
      lastSig = sig;
    }
  }
  await store.setConfirming(groupId, 'max_steps');
  return { outcome: 'confirming', reason: 'max_steps' };
}
