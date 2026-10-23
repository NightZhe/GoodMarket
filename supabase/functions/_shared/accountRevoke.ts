// 刪帳號前的管理刪卡（.work/account-payment-methods/spec-account-delete-cards.md；D33＝A＋C、D36＝A、D37＝A）。
// 流程：資料庫把這個帳號的卡全部標成 revoking（不能再扣款）→ 逐張向綠界刪除 → 用會員綁卡清單反查（以綠界為準）→
// 清單裡本站不知道的卡（孤兒卡）一起刪 → 再查一次，剩 0 張才算完成。
// 回應會被存檔、可能貼進對話：不含 BindCardID、會員代號原文（R-8）。孤兒卡用前 6／後 4＋BindCardID 的 sha256 前 8 碼識別。
import type { BoundCard, DeleteCardResult } from './ecpayClient.ts';

export interface RevokeCard { id: string; bindCardId: string; card6: string; card4: string; statusBefore: 'active' | 'revoking'; revokeFailures: number }

export type BeginResult =
  | { ok: true; memberId: string | null; cards: RevokeCard[] }
  | { ok: false; code: string; message: string; retryAfter: string | null };

/** 資料庫那一側（實作：accountRevokeStore.ts，service role 呼叫 admin_revoke_account_begin 等函式） */
export interface RevokeStore {
  begin(userId: string): Promise<BeginResult>;
  finishDelete(methodId: string): Promise<void>;
  recordFailure(methodId: string): Promise<void>;
  countMethods(userId: string): Promise<number>;
}

export interface RevokeGateway {
  deleteBindCard(a: { bindMerchantId: string; bindCardId: string }): Promise<DeleteCardResult>;
  queryBindCards(a: { bindMerchantId: string; memberId: string }): Promise<{ ok: true; cards: BoundCard[] } | { ok: false; rtnCode: number | null; rtnMsg: string }>;
}

export type CardResult = 'deleted' | 'already_gone' | 'failed';
export interface CardReport { id: string; card6: string; card4: string; statusBefore: 'active' | 'revoking'; result: CardResult; rtnCode: number | null; rtnMsg: string | null }
export interface OrphanReport { card6: string; card4: string; ref: string; result: CardResult; rtnCode: number | null; rtnMsg: string | null }
export interface RevokeReport {
  userId: string;
  /** 開始刪卡的時間（呼叫資料庫標 revoking 之前取）。刪除 SQL 擋「這之後才開始的綁卡」，所以不能用請求結束的時間 */
  checkedAt: string;
  hasMember: boolean;
  allRevoked: boolean;
  queryOk: boolean;
  /** 綠界清單最後剩幾張（查不到時 null） */
  ecpayRemaining: number | null;
  /** 本站 payment_methods 最後剩幾列 */
  siteRemaining: number;
  cards: CardReport[];
  orphans: OrphanReport[];
  /** 綠界清單查詢失敗時，綠界回了什麼 */
  queryError: { rtnCode: number | null; rtnMsg: string } | null;
}

export class RevokeRefused extends Error {
  constructor(readonly code: string, message: string, readonly retryAfter: string | null) { super(message); }
}

export interface RevokeDeps { store: RevokeStore; gateway: RevokeGateway; bindMerchantId: string; now: () => number }

const fromDelete = (r: Exclude<DeleteCardResult, { kind: 'done' }>) =>
  r.kind === 'failed' ? { rtnCode: r.rtnCode, rtnMsg: r.rtnMsg } : { rtnCode: null, rtnMsg: r.reason };

/** 孤兒卡的識別碼：BindCardID 的 sha256 前 8 碼（不可逆；使用者要對綠界時可以自己從清單算出來比對） */
export async function cardRef(bindCardId: string): Promise<string> {
  const h = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(bindCardId)));
  return [...h.slice(0, 4)].map((x) => x.toString(16).padStart(2, '0')).join('');
}

/** 綠界訊息原樣回報，但遮掉任何 BindCardID 與會員代號（R-8），並限制長度 */
const redactor = (secrets: string[]) => {
  const list = secrets.filter((x) => x.length >= 4).sort((a, b) => b.length - a.length);
  return (msg: string | null) => {
    if (msg === null) return null;
    let out = msg;
    for (const x of list) out = out.split(x).join('[redacted]');
    return out.slice(0, 200);
  };
};

export async function revokeAccountCards(deps: RevokeDeps, userId: string): Promise<RevokeReport> {
  const { store, gateway, bindMerchantId } = deps;
  const checkedAt = new Date(deps.now()).toISOString();
  const b = await store.begin(userId);
  if (!b.ok) throw new RevokeRefused(b.code, b.message, b.retryAfter);
  const known = new Set(b.cards.map((c) => c.bindCardId));
  const secrets = [...known, ...(b.memberId ? [b.memberId] : [])];

  // 0. 沒有會員列也沒有卡（E-8）：這個帳號從來沒把會員代號送到綠界，綠界上不可能有它的卡
  if (b.memberId === null && b.cards.length === 0) {
    return { userId, checkedAt, hasMember: false, allRevoked: true, queryOk: true,
      ecpayRemaining: 0, siteRemaining: await store.countMethods(userId), cards: [], orphans: [], queryError: null };
  }

  // 1. 本站記錄的每一張卡（active 與 revoking）都向綠界刪除
  const cards: CardReport[] = [];
  const pending: { card: RevokeCard; report: CardReport }[] = [];
  for (const c of b.cards) {
    const r = await gateway.deleteBindCard({ bindMerchantId, bindCardId: c.bindCardId });
    const report: CardReport = { id: c.id, card6: c.card6, card4: c.card4, statusBefore: c.statusBefore, result: 'deleted', rtnCode: 1, rtnMsg: null };
    if (r.kind === 'done') await store.finishDelete(c.id);
    else { Object.assign(report, { result: 'failed' }, fromDelete(r)); pending.push({ card: c, report }); }
    cards.push(report);
  }

  // 2. 以綠界的會員綁卡清單為準（R-5）：刪除失敗、但清單裡已經沒有的卡 → already_gone
  const query = () => b.memberId !== null ? gateway.queryBindCards({ bindMerchantId, memberId: b.memberId })
    : Promise.resolve({ ok: false as const, rtnCode: null, rtnMsg: 'no payment member' });
  let q = await query();
  const orphans: OrphanReport[] = [];
  if (q.ok) {
    const listed = new Set(q.cards.map((c) => c.bindCardId));
    for (const p of pending) {
      if (!listed.has(p.card.bindCardId)) { p.report.result = 'already_gone'; await store.finishDelete(p.card.id); }
    }
    // 3. 清單裡、但不是本站還沒刪掉的卡 → 孤兒卡（D36＝A：同一步一起刪）
    const stillOurs = new Set(pending.filter((p) => p.report.result === 'failed').map((p) => p.card.bindCardId));
    const orphanCards = q.cards.filter((c) => !stillOurs.has(c.bindCardId));
    for (const c of orphanCards) {
      secrets.push(c.bindCardId);
      const r = await gateway.deleteBindCard({ bindMerchantId, bindCardId: c.bindCardId });
      orphans.push({ card6: c.card6, card4: c.card4, ref: await cardRef(c.bindCardId), result: r.kind === 'done' ? 'deleted' : 'failed',
        ...(r.kind === 'done' ? { rtnCode: 1, rtnMsg: null } : fromDelete(r)) });
    }
    // 4. 有刪孤兒卡就再查一次，以最後的清單為準
    if (orphanCards.length) {
      q = await query();
      if (q.ok) {
        const left = new Set(q.cards.map((c) => c.bindCardId));
        orphanCards.forEach((c, i) => { if (orphans[i].result === 'failed' && !left.has(c.bindCardId)) orphans[i].result = 'already_gone'; });
      }
    }
  }
  for (const p of pending) if (p.report.result === 'failed') await store.recordFailure(p.card.id);

  const ecpayRemaining = q.ok ? q.cards.length : null;
  const siteRemaining = await store.countMethods(userId);
  const allRevoked = q.ok && ecpayRemaining === 0 && siteRemaining === 0
    && cards.every((c) => c.result !== 'failed') && orphans.every((o) => o.result !== 'failed');
  const redact = redactor(secrets);
  return {
    userId, checkedAt, hasMember: b.memberId !== null,
    allRevoked, queryOk: q.ok, ecpayRemaining, siteRemaining,
    cards: cards.map((c) => ({ ...c, rtnMsg: redact(c.rtnMsg) })),
    orphans: orphans.map((o) => ({ ...o, rtnMsg: redact(o.rtnMsg) })),
    queryError: q.ok ? null : { rtnCode: q.rtnCode, rtnMsg: redact(q.rtnMsg)! },
  };
}

const safeEqual = (a: string, b: string) => {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
};

/** 管理密碼（PAYMENT_ADMIN_SECRET，D34＝B）。沒設、太短、或跟排程密碼相同都視為設定錯誤，一律拒絕。 */
export function adminSecretOk(given: string, cfg: { adminSecret?: string; cronSecret?: string }): boolean {
  const s = cfg.adminSecret;
  if (!s || s.length < 32) return false;
  if (cfg.cronSecret && safeEqual(s, cfg.cronSecret)) return false;
  return safeEqual(given, s);
}
