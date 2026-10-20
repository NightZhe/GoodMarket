// 綠界 API 用戶端（站內付 2.0 綁卡、幕後授權、請退款、查詢）。所有 HTTP 都經由注入的 fetch，時間由注入的 now，
// 所以可以不連網測試。平台商金鑰只從 EcpayConfig 進來（呼叫端從環境變數／secrets 讀）。
import { buildRequest, parseEnvelope, type EcpayEnvelope } from './ecpayCrypto.ts';
import { classifyAuthCode } from './ecpayCodes.ts';

export interface EcpayConfig {
  env: 'stage' | 'prod';
  platformId: string;
  hashKey: string;
  hashIv: string;
  ecpgBase: string;        // 綁卡與幕後授權：https://ecpg(-stage).ecpay.com.tw
  ecpaymentBase: string;   // 請退款與查詢：https://ecpayment(-stage).ecpay.com.tw
  /** 幕後授權要求的 ReturnURL（付款結果背景通知），公開網址 */
  payReturnUrl?: string;
}

export const ecpayBases = (env: 'stage' | 'prod') => env === 'prod'
  ? { ecpgBase: 'https://ecpg.ecpay.com.tw', ecpaymentBase: 'https://ecpayment.ecpay.com.tw' }
  : { ecpgBase: 'https://ecpg-stage.ecpay.com.tw', ecpaymentBase: 'https://ecpayment-stage.ecpay.com.tw' };

/** 呼叫逾時：文件建議至少 30 秒（35596、35630）；留 40 秒。 */
export const CALL_TIMEOUT_MS = 40_000;

type Raw = Record<string, any>;
type Posted = { kind: 'ok'; data: Raw } | { kind: 'rejected'; transMsg: string } | { kind: 'unknown'; error: string };

export type CardStatus = 'authorized' | 'unauthorized' | 'cancelled' | 'to_capture' | 'captured' | 'op_canceled' | 'other';

export type Inquiry =
  | { kind: 'none' }                                                    // 綠界沒有這筆（error_nopay）
  | { kind: 'found'; tradeNo: string; status: CardStatus; amount: number }
  | { kind: 'unknown' };

export type AuthorizeResult =
  | { kind: 'authorized'; tradeNo: string; card6: string | null; card4: string | null }
  | { kind: 'declined'; rtnCode: number | null; rtnMsg: string; cardInvalid: boolean }
  | { kind: 'unknown'; reason: string };

export type ActionResult = { kind: 'done' } | { kind: 'failed'; rtnMsg: string } | { kind: 'unknown' };
/** 刪除綁卡（35608）的結果：失敗時帶回綠界的代碼與訊息、逾時帶原因（管理刪卡要逐張回報綠界回了什麼） */
export type DeleteCardResult = { kind: 'done' } | { kind: 'failed'; rtnCode: number | null; rtnMsg: string } | { kind: 'unknown'; reason: string };

export type BindResult =
  | { kind: 'bound'; bindCardId: string; isSameCard: boolean; card6: string; card4: string; expYear: string; expMonth: string; tradeNo: string; merchantTradeNo: string }
  | { kind: 'need3d'; url: string; merchantTradeNo: string }
  | { kind: 'failed'; rtnCode: number | null; rtnMsg: string }
  | { kind: 'unknown' };

/** 查詢綁卡清單：會員沒有任何綁卡（從沒綁過、或全部刪光）時綠界回這個碼，不是查詢失敗。
 *  刪除不存在的 BindCardID 也回同一個碼。B-0 本機對綠界測試環境實測（.work/account-payment-methods/t6-delete-cards-probe.md）；35613／35608 文件都沒寫 */
export const NO_BIND_CARD_CODE = 5100088;
const codeOf = (v: unknown): number | null => { const n = typeof v === 'number' ? v : Number(v); return Number.isFinite(n) ? n : null; };
const unknownMsg = (err: string) => (err === 'TimeoutError' ? 'timeout' : err || 'unknown');

export interface BoundCard { card6: string; card4: string; expYear: string; expMonth: string; bindCardId: string }

/** 查無交易：本機對綠界測試環境實測，兩支查詢 API 對不存在的 MerchantTradeNo 都回 10000185（文件寫的 error_nopay 是 DoAction 對已取消交易的回應） */
const NO_TRADE_CODE = 10000185;

const STATUS_MAP: Record<string, CardStatus> = {
  'authorized': 'authorized', 'unauthorized': 'unauthorized', 'cancelled': 'cancelled', 'canceled': 'cancelled',
  'to be captured': 'to_capture', 'captured': 'captured', 'operation canceled': 'op_canceled', 'operation cancelled': 'op_canceled',
};
export const mapCardStatus = (raw: unknown): CardStatus => STATUS_MAP[String(raw ?? '').trim().toLowerCase()] ?? 'other';

const tw = (ms: number) => {
  const d = new Date(ms + 8 * 3600_000), p = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}/${p(d.getUTCMonth() + 1)}/${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`;
};
export const twDateTime = tw;

export function createEcpayClient(cfg: EcpayConfig, fetchFn: typeof fetch = fetch, nowMs: () => number = Date.now) {
  async function post(base: string, path: string, data: Raw): Promise<Posted> {
    try {
      const req = await buildRequest(cfg.platformId, { PlatformID: cfg.platformId, ...data }, cfg.hashKey, cfg.hashIv, Math.floor(nowMs() / 1000));
      const res = await fetchFn(base + path, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(req), signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
      });
      if (!res.ok) return { kind: 'unknown', error: `http ${res.status}` };
      const env = (await res.json()) as EcpayEnvelope;
      const p = await parseEnvelope<Raw>(env, cfg.hashKey, cfg.hashIv);
      return p.ok ? { kind: 'ok', data: p.data } : { kind: 'rejected', transMsg: p.transMsg };
    } catch (e) {
      return { kind: 'unknown', error: e instanceof Error ? e.name : 'error' };
    }
  }
  const ecpg = (path: string, data: Raw) => post(cfg.ecpgBase, path, data);
  const ecpayment = (path: string, data: Raw) => post(cfg.ecpaymentBase, path, data);

  // ── 綁卡 ──
  async function getBindToken(a: { bindMerchantId: string; memberId: string; email?: string; phone?: string; merchantTradeNo: string; tradeDate: string; amount: number; returnUrl: string; orderResultUrl: string }) {
    const r = await ecpg('/Merchant/GetTokenbyBindingCard', {
      MerchantID: a.bindMerchantId,
      ConsumerInfo: { MerchantMemberID: a.memberId, ...(a.email ? { Email: a.email } : {}), ...(a.phone ? { Phone: a.phone } : {}), CountryCode: '158' },
      OrderInfo: { MerchantTradeDate: a.tradeDate, MerchantTradeNo: a.merchantTradeNo, TotalAmount: a.amount, TradeDesc: '綁定信用卡', ItemName: '綁定信用卡驗證', ReturnURL: a.returnUrl },
      OrderResultURL: a.orderResultUrl,
    });
    if (r.kind === 'unknown') return { ok: false as const, kind: 'unknown' as const, rtnMsg: r.error };
    if (r.kind === 'rejected') return { ok: false as const, kind: 'rejected' as const, rtnMsg: r.transMsg };
    if (r.data.RtnCode !== 1) return { ok: false as const, kind: 'rejected' as const, rtnMsg: String(r.data.RtnMsg ?? '') };
    return { ok: true as const, token: String(r.data.Token), expiresAt: String(r.data.TokenExpireDate ?? '') };
  }

  async function createBindCard(a: { bindMerchantId: string; memberId: string; bindCardPayToken: string }): Promise<BindResult> {
    const r = await ecpg('/Merchant/CreateBindCard', { MerchantID: a.bindMerchantId, BindCardPayToken: a.bindCardPayToken, MerchantMemberID: a.memberId });
    if (r.kind === 'unknown') return { kind: 'unknown' };
    if (r.kind === 'rejected') return { kind: 'failed', rtnCode: null, rtnMsg: r.transMsg };
    const d = r.data;
    if (d.RtnCode !== 1) return { kind: 'failed', rtnCode: typeof d.RtnCode === 'number' ? d.RtnCode : null, rtnMsg: String(d.RtnMsg ?? '') };
    if (d.ThreeDInfo?.ThreeDURL) return { kind: 'need3d', url: String(d.ThreeDInfo.ThreeDURL), merchantTradeNo: String(d.OrderInfo?.MerchantTradeNo ?? '') };
    return bindFromData(d);
  }

  async function queryBindCards(a: { bindMerchantId: string; memberId: string; merchantTradeNo?: string }) {
    const r = await ecpg('/Merchant/GetMemberBindCard', { MerchantID: a.bindMerchantId, MerchantMemberID: a.memberId, ...(a.merchantTradeNo ? { MerchantTradeNo: a.merchantTradeNo } : {}) });
    if (r.kind === 'unknown') return { ok: false as const, rtnCode: null, rtnMsg: unknownMsg(r.error) };
    if (r.kind === 'rejected') return { ok: false as const, rtnCode: null, rtnMsg: r.transMsg };
    if (r.data.RtnCode === NO_BIND_CARD_CODE) return { ok: true as const, cards: [] as BoundCard[] };
    if (r.data.RtnCode !== 1) return { ok: false as const, rtnCode: codeOf(r.data.RtnCode), rtnMsg: String(r.data.RtnMsg ?? '') };
    const list = Array.isArray(r.data.BindCardList) ? r.data.BindCardList : [];
    return { ok: true as const, cards: list.map((c: Raw): BoundCard => ({ card6: String(c.Card6No), card4: String(c.Card4No), expYear: String(c.CardValidYY), expMonth: String(c.CardValidMM), bindCardId: String(c.BindCardID) })) };
  }

  async function deleteBindCard(a: { bindMerchantId: string; bindCardId: string }): Promise<DeleteCardResult> {
    const r = await ecpg('/Merchant/DeleteMemberBindCard', { MerchantID: a.bindMerchantId, BindCardID: a.bindCardId });
    if (r.kind === 'unknown') return { kind: 'unknown', reason: unknownMsg(r.error) };
    if (r.kind === 'rejected') return { kind: 'failed', rtnCode: null, rtnMsg: r.transMsg };
    return r.data.RtnCode === 1 ? { kind: 'done' } : { kind: 'failed', rtnCode: codeOf(r.data.RtnCode), rtnMsg: String(r.data.RtnMsg ?? '') };
  }

  // ── 授權 ──
  async function authorize(a: { merchantId: string; merchantTradeNo: string; amount: number; bindCardId: string; memberId: string; itemName: string; buyerEmail?: string; tradeDate: string }): Promise<AuthorizeResult> {
    const r = await ecpg('/Merchant/CreatePaymentWithCardID', {
      MerchantID: a.merchantId, BindCardID: a.bindCardId,
      OrderInfo: { MerchantTradeDate: a.tradeDate, MerchantTradeNo: a.merchantTradeNo, TotalAmount: a.amount, TradeDesc: '好物集訂單', ItemName: a.itemName.slice(0, 200), ReturnURL: cfg.payReturnUrl ?? 'https://invalid.example/payment-return' },
      ConsumerInfo: { MerchantMemberID: a.memberId, ...(a.buyerEmail ? { Email: a.buyerEmail } : {}), CountryCode: '158' },
      Need3D: 0,
    });
    if (r.kind === 'unknown') return { kind: 'unknown', reason: r.error };
    if (r.kind === 'rejected') return { kind: 'declined', rtnCode: null, rtnMsg: r.transMsg, cardInvalid: false }; // 封包沒被處理，沒有授權
    const code = typeof r.data.RtnCode === 'number' ? r.data.RtnCode : Number(r.data.RtnCode);
    const cls = classifyAuthCode(code);
    if (cls === 'authorized') {
      return { kind: 'authorized', tradeNo: String(r.data.OrderInfo?.TradeNo ?? ''), card6: r.data.CardInfo?.Card6No ?? null, card4: r.data.CardInfo?.Card4No ?? null };
    }
    if (cls === 'unknown') return { kind: 'unknown', reason: String(code) };
    return { kind: 'declined', rtnCode: Number.isFinite(code) ? code : null, rtnMsg: String(r.data.RtnMsg ?? ''), cardInvalid: cls === 'card_invalid' };
  }

  async function inquire(a: { merchantId: string; merchantTradeNo: string }): Promise<Inquiry> {
    const d = await ecpayment('/1.0.0/CreditDetail/QueryTrade', { MerchantID: a.merchantId, MerchantTradeNo: a.merchantTradeNo });
    if (d.kind !== 'ok') return { kind: 'unknown' };
    if (d.data.RtnMsg === 'error_nopay' || d.data.RtnCode === NO_TRADE_CODE) return { kind: 'none' };
    if (d.data.RtnMsg || !d.data.RtnValue) return { kind: 'unknown' }; // error_Stop／error／空
    const t = await ecpayment('/1.0.0/Cashier/QueryTrade', { MerchantID: a.merchantId, MerchantTradeNo: a.merchantTradeNo });
    if (t.kind !== 'ok') return { kind: 'unknown' };
    if (t.data.RtnCode === NO_TRADE_CODE) return { kind: 'none' };
    if (t.data.RtnCode !== 1 || !t.data.OrderInfo?.TradeNo) return { kind: 'unknown' };
    return { kind: 'found', tradeNo: String(t.data.OrderInfo.TradeNo), status: mapCardStatus(d.data.RtnValue.Status), amount: Number(d.data.RtnValue.Amount ?? t.data.OrderInfo.TradeAmt ?? 0) };
  }

  async function doAction(ref: { merchantId: string; merchantTradeNo: string; tradeNo: string; amount: number }, action: 'C' | 'R' | 'E' | 'N'): Promise<'ok' | 'rejected' | 'unknown'> {
    const r = await ecpayment('/1.0.0/Credit/DoAction', { MerchantID: ref.merchantId, MerchantTradeNo: ref.merchantTradeNo, TradeNo: ref.tradeNo, Action: action, TotalAmount: ref.amount });
    if (r.kind === 'unknown') return 'unknown';
    return r.kind === 'ok' && r.data.RtnCode === 1 ? 'ok' : 'rejected';
  }

  /** 做完動作（或動作被拒）後再查一次，以綠界的實際狀態為準 */
  async function verified(ref: { merchantId: string; merchantTradeNo: string }, accept: CardStatus[], rtnMsg: string): Promise<ActionResult> {
    const q = await inquire(ref);
    if (q.kind === 'unknown') return { kind: 'unknown' };
    if (q.kind === 'found' && accept.includes(q.status)) return { kind: 'done' };
    return { kind: 'failed', rtnMsg };
  }

  async function capture(ref: { merchantId: string; merchantTradeNo: string; amount: number }): Promise<ActionResult> {
    const q = await inquire(ref);
    if (q.kind === 'unknown') return { kind: 'unknown' };
    if (q.kind === 'none') return { kind: 'failed', rtnMsg: 'no authorization' };
    if (q.status === 'to_capture' || q.status === 'captured') return { kind: 'done' };      // 自動關帳可能已先動手
    if (q.status !== 'authorized' && q.status !== 'op_canceled') return { kind: 'failed', rtnMsg: `status ${q.status}` };
    const a = await doAction({ ...ref, tradeNo: q.tradeNo, amount: q.amount || ref.amount }, 'C');
    if (a === 'unknown') return { kind: 'unknown' };
    return verified(ref, ['to_capture', 'captured'], 'capture rejected');
  }

  /** 放棄這筆授權：依綠界現況選動作（35642）——已授權 N；要關帳 E 再 N；已關帳 R；已取消／沒授權／沒有這筆 → 已完成 */
  async function abandon(ref: { merchantId: string; merchantTradeNo: string; amount: number }): Promise<ActionResult> {
    const q = await inquire(ref);
    if (q.kind === 'unknown') return { kind: 'unknown' };
    if (q.kind === 'none') return { kind: 'done' };
    const full = { ...ref, tradeNo: q.tradeNo, amount: q.amount || ref.amount };
    switch (q.status) {
      case 'cancelled': case 'unauthorized': return { kind: 'done' };
      case 'authorized': case 'op_canceled': {
        const n = await doAction(full, 'N');
        if (n === 'unknown') return { kind: 'unknown' };
        return verified(ref, ['cancelled'], 'abandon rejected');
      }
      case 'to_capture': {
        const e = await doAction(full, 'E');
        if (e === 'unknown') return { kind: 'unknown' };
        if (e === 'rejected') return verified(ref, ['cancelled', 'op_canceled'], 'cancel-close rejected').then((v) => v.kind === 'done' ? abandon(ref) : v);
        const n = await doAction(full, 'N');
        if (n === 'unknown') return { kind: 'unknown' };
        return verified(ref, ['cancelled'], 'abandon rejected');
      }
      case 'captured': {
        const rr = await doAction(full, 'R');
        if (rr === 'unknown') return { kind: 'unknown' };
        return rr === 'ok' ? { kind: 'done' } : { kind: 'failed', rtnMsg: 'refund rejected' };
      }
      default: return { kind: 'failed', rtnMsg: `status ${q.status}` };
    }
  }

  return { getBindToken, createBindCard, queryBindCards, deleteBindCard, authorize, inquire, capture, abandon, now: () => tw(nowMs()) };
}

export type EcpayClient = ReturnType<typeof createEcpayClient>;

/** 綁卡成功的 Data（35596 回應、ReturnURL／OrderResultURL 通知都是同一格式）轉成內部格式 */
export function bindFromData(d: Raw): BindResult {
  if (d.RtnCode !== 1) return { kind: 'failed', rtnCode: typeof d.RtnCode === 'number' ? d.RtnCode : null, rtnMsg: String(d.RtnMsg ?? '') };
  if (!d.BindCardID) return { kind: 'failed', rtnCode: 1, rtnMsg: 'BindCardID empty' };
  return {
    kind: 'bound', bindCardId: String(d.BindCardID), isSameCard: d.IsSameCard === true,
    card6: String(d.CardInfo?.Card6No ?? ''), card4: String(d.CardInfo?.Card4No ?? ''),
    expYear: String(d.CardInfo?.CardValidYY ?? ''), expMonth: String(d.CardInfo?.CardValidMM ?? ''),
    tradeNo: String(d.OrderInfo?.TradeNo ?? ''), merchantTradeNo: String(d.OrderInfo?.MerchantTradeNo ?? ''),
  };
}
