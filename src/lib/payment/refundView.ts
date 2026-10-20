import type { Order, OrderStatus } from '../../types';
import { money } from '../format';
import type { OrderPayState } from './orderView';
import type { BuyerCancelReason, OrderRefundRow, RefundView, SellerCancelReason, ShopOrderRefundRow } from './types';

// 已付款訂單的取消與退款：畫面上每個狀態該顯示什麼。文字逐字取自 .work/account-payment-methods/design-refund.md
// （買家 B1～B9 見 4.2、賣家 S1～S11 見 5.2、{誰}{原因} 見 4.3）。純函式，畫面元件只負責把這裡的結果畫出來。
// 用語照 spec-refund.md §4：取消申請、退款、取消授權、退刷、退款處理中、已退款（沒有「失敗」，D29）。

/** 賣家多久內沒回應會自動同意（D27）。H-RF6：第一個月可能調，所以集中一處；畫面上的截止「時間」一律用伺服器給的 respond_by，不自己加 */
export const CANCEL_RESPOND_HOURS = 48;
/** 補充說明、拒絕原因的字數上限（伺服器同） */
export const NOTE_MAX = 100;
/** 退款處理中超過幾天，買家文案多一行聯絡方式（B5′） */
const LONG_REFUNDING_MS = 3 * 24 * 60 * 60 * 1000;

export const BUYER_CANCEL_REASONS: { code: BuyerCancelReason; label: string }[] = [
  { code: 'no_longer_wanted', label: '不想買了' },
  { code: 'change_item', label: '想更換商品或規格' },
  { code: 'duplicate_order', label: '重複下單' },
  { code: 'seller_too_slow', label: '賣家太久沒出貨' },
  { code: 'other', label: '其他' },
];
export const SELLER_CANCEL_REASONS: { code: SellerCancelReason; label: string }[] = [
  { code: 'out_of_stock', label: '缺貨或無法出貨' },
  { code: 'buyer_asked', label: '買家要求取消' },
  { code: 'listing_error', label: '價格或商品資訊有誤' },
  { code: 'other', label: '其他' },
];
const REASON_LABEL: Record<string, string> = Object.fromEntries([...BUYER_CANCEL_REASONS, ...SELLER_CANCEL_REASONS].map(r => [r.code, r.label]));

/** 「其他」且有說明：「其他（說明）」；沒說明：「其他」。其他代碼不帶說明。說明是使用者輸入，只當純文字 */
export function reasonText(code: string, note: string | null): string {
  const label = REASON_LABEL[code] ?? '其他';
  const text = note?.trim();
  return code === 'other' && text ? `${label}（${text}）` : label;
}

// ── 狀態區塊的內容 ──
/** 一行文字的片段：字串，或由元件另外畫的「卡別 •••• 末四碼」、「聯絡信箱連結」 */
export type Seg = string | { card: true } | { mail: true };
export type Line = Seg[];
export type Tone = 'info' | 'success' | 'neutral' | 'warning';
export interface StatusBlock { tone: Tone; title: string; lines: Line[] }

const CONTACT: Line = ['如有疑問請聯絡我們：', { mail: true }, '。'];
const ONCE_ONLY = '訂單照常出貨。每張訂單只能申請一次，這筆訂單不能再申請取消。';

/** 期限已過、排程還沒處理（最久約 1～2 分鐘）。只用來決定第二行字，不用來判斷訂單狀態（設計 8 第 5 點） */
export const isRespondOverdue = (respondBy: string, now: number): boolean => Date.parse(respondBy) < now;

const present = <T>(xs: (T | null | false)[]): T[] => xs.filter((x): x is T => Boolean(x));
// 文案句號規則（主對話裁定）：說明句一律以「。」結尾；引述使用者輸入的原因那一行，原樣顯示、不另加句號
const oneLine = (text: string | null): Line | null => (text ? [text] : null);

/** 句子裡的卡別：讀到就接元件畫的「Visa •••• 4242」，讀不到整段寫成 unknown（買家端「你付款的信用卡」） */
export function cardLine(known: boolean, before: string, after: string, unknown = '你付款的信用卡'): Line {
  return known ? [`${before} `, { card: true }, after] : [`${before}${unknown}${after}`];
}

// ── 買家 ──
export type BuyerChip = 'cancelRequested' | 'refunding' | 'refunded';
export interface BuyerRefundView { chip: BuyerChip | null; block: StatusBlock | null }
export interface BuyerViewCtx {
  /** 訂單金額（含運費）；退款一律全額（R-RF4），金額從訂單來 */
  total: number;
  /** get_order_payments 有給卡別與末四碼 */
  cardKnown: boolean;
  now: number;
  /** 「10/22 14:02」 */
  time: (iso: string) => string;
  /** 「10/22」 */
  day: (iso: string) => string;
}

function buyerWho(row: OrderRefundRow): string | null {
  const why = row.cancel_reason ? `原因：${reasonText(row.cancel_reason, row.cancel_note)}。` : '';
  switch (row.cancelled_by) {
    case 'buyer': return `你申請取消，賣家已同意。${why}`;
    case 'seller': return `賣家取消了這筆訂單。${why}`;
    case 'auto': return `你申請取消，賣家在期限內沒有回應，系統已自動同意。${why}`;
    default: return null;
  }
}

/**
 * 買家訂單卡的退款相關內容。先看訂單狀態，再看付款面（get_order_payments 的 payState），再用 get_my_order_refunds 的 row 補細節；
 * 付款面說退款中／已退款、但細節讀不到時走 B9／B8，不讓整張卡壞掉
 */
export function buyerRefundView(
  a: { status: OrderStatus; payState: OrderPayState; row: OrderRefundRow | undefined },
  ctx: BuyerViewCtx,
): BuyerRefundView {
  const { status, payState, row } = a;
  const req = row?.cancel_request ?? null;
  const refund: RefundView | null = row?.refund ?? null;
  const amount = money(ctx.total);
  const who = row ? buyerWho(row) : null;

  const refundState = refund?.status ?? (payState === 'refunded' ? 'refunded' : payState === 'refunding' ? 'refunding' : null);

  if (refundState === 'refunded') {
    if (status !== 'cancelled') {
      // B8：運送中／已完成、由維運對齊的退款（D28），訂單狀態不變
      return { chip: 'refunded', block: { tone: 'success', title: '已退款', lines: [cardLine(ctx.cardKnown, `這筆訂單的 ${amount} 已退回你付款的`, '。入帳時間依發卡銀行作業。', '信用卡')] } };
    }
    if (!refund) return B9;
    const doneAt = refund.refunded_at ?? refund.started_at;
    if (refund.method === 'void') {
      return { chip: 'refunded', block: { tone: 'success', title: '已退款', lines: present<Line>([
        [`已取消授權，這筆 ${amount} 不會向你請款。`],
        ['若銀行 App 先出現一筆暫時的授權紀錄，會由發卡銀行自動消失，消失時間依發卡銀行而定。'],
        oneLine(who),
      ]) } };
    }
    if (refund.method === 'card_refund') {
      return { chip: 'refunded', block: { tone: 'success', title: '已退款', lines: present<Line>([
        cardLine(ctx.cardKnown, `已退刷 ${amount} 到`, `（${ctx.day(doneAt)}）。`),
        ['入帳時間依發卡銀行作業，可能出現在本期或下一期帳單。'],
        oneLine(who),
      ]) } };
    }
    // B7′：維運人工完成（manual）
    return { chip: 'refunded', block: { tone: 'success', title: '已退款', lines: present<Line>([
      cardLine(ctx.cardKnown, `${amount} 已退回你付款的`, '。入帳時間依發卡銀行作業。', '信用卡'),
      oneLine(who),
    ]) } };
  }

  if (refundState === 'refunding') {
    if (!refund) return B9;
    // B5；超過 3 天或被標記需要人工（B5′）多一行聯絡方式。不出現「失敗」（D29）
    const long = refund.needs_attention_since !== null || Date.parse(refund.started_at) + LONG_REFUNDING_MS <= ctx.now;
    return { chip: 'refunding', block: { tone: 'info', title: '退款處理中', lines: present<Line>([
      cardLine(ctx.cardKnown, `全額 ${amount} 會退回`, '。完成後這裡會顯示退款方式。'),
      oneLine(who),
      long && CONTACT,
    ]) } };
  }

  if (status === 'cancelled' && (payState === 'paid')) return B9;

  if (req && status === 'to_ship') {
    if (req.status === 'pending') {
      const overdue = isRespondOverdue(req.respond_by, ctx.now);
      return { chip: 'cancelRequested', block: { tone: 'info', title: '取消申請中，等賣家回應', lines: [
        [`你在 ${ctx.time(req.requested_at)} 申請取消，原因：${reasonText(req.reason, req.note)}。`],
        [overdue ? '回應期限已到，系統正在處理，完成後這裡會更新。' : `賣家回應前不會出貨。賣家在 ${ctx.time(req.respond_by)} 前沒有回應，訂單會自動取消並退款。`],
      ] } };
    }
    if (req.status === 'rejected') {
      return { chip: null, block: { tone: 'neutral', title: '賣家沒有同意取消', lines: [[`原因：${req.reject_reason ?? ''}`], [ONCE_ONLY], CONTACT] } };
    }
    if (req.status === 'withdrawn') {
      return { chip: null, block: { tone: 'neutral', title: '你已撤回取消申請', lines: [[ONCE_ONLY], CONTACT] } };
    }
  }
  return { chip: null, block: null };
}

/** B9：已取消的已付款單，退款細節讀不到（讀取失敗或排程剛好空檔）。沒有金額、卡別，因為沒讀到 */
const B9: BuyerRefundView = { chip: null, block: { tone: 'info', title: '退款處理中', lines: [['完成後這裡會顯示退款方式。']] } };

// ── 賣家 ──
export type SellerBadge = 'requested' | 'refunding' | 'refunded';
export interface SellerRefundView {
  badge: SellerBadge | null;
  block: StatusBlock | null;
  /** 付款面：給 footer 的付款標籤換結尾字用 */
  refundStatus: 'refunding' | 'refunded' | null;
  /** 退款中、已退款的單不顯示「進帳資訊」與撥款區塊（spec 8.2、設計 5.3） */
  hidePayout: boolean;
}
export interface SellerViewCtx { total: number; now: number; time: (iso: string) => string }

function sellerWho(row: OrderRefundRow): string | null {
  const why = row.cancel_reason ? `原因：${reasonText(row.cancel_reason, row.cancel_note)}。` : '';
  switch (row.cancelled_by) {
    case 'seller': return `你取消了這筆訂單。${why}`;
    case 'buyer': return `買家申請取消，你已同意。${why}`;
    case 'auto': return `買家申請取消，你在期限內沒有回應，系統已自動同意。${why}`;
    default: return null;
  }
}

/**
 * 賣家訂單卡的退款相關內容。賣家讀不到 payment_status（C-3），一律以 get_shop_order_refunds 的 row 判斷。
 * H-RF3 確認前，需要人工且 manual_hint='balance' 也照 S9 的字（S10 預留不上線）
 */
export function sellerRefundView(
  a: { status: OrderStatus; payment: Order['payment']; row: ShopOrderRefundRow | undefined },
  ctx: SellerViewCtx,
): SellerRefundView {
  const { status, payment, row } = a;
  const req = row?.cancel_request ?? null;
  const refund = row?.refund ?? null;
  const amount = money(ctx.total);
  const who = row ? sellerWho(row) : null;
  const none: SellerRefundView = { badge: null, block: null, refundStatus: null, hidePayout: false };

  if (refund?.status === 'refunded') {
    const at = ctx.time(refund.refunded_at ?? refund.started_at);
    const done = (lines: Line[]): SellerRefundView => ({ badge: 'refunded', refundStatus: 'refunded', hidePayout: true, block: { tone: 'success', title: '已退款', lines } });
    if (status !== 'cancelled') return done([[`這筆訂單的 ${amount} 已退款給買家（${at}）。`]]); // S8
    if (refund.method === 'void') return done(present<Line>([[`${amount} 已退款給買家（取消授權，${at}）。`], ['取消授權：這筆款項不會向買家請款。'], oneLine(who)]));
    if (refund.method === 'card_refund') return done(present<Line>([[`${amount} 已退款給買家（退刷，${at}）。`], ['退刷：款項已請款，已退回買家的信用卡。'], oneLine(who)]));
    return done(present<Line>([[`${amount} 已退款給買家（${at}）。`], oneLine(who)])); // S7′
  }

  if (refund?.status === 'refunding') {
    const title = row?.needs_manual ? '退款還沒完成，好物集正在處理。' : '退款處理中'; // S9／S5
    return { badge: 'refunding', refundStatus: 'refunding', hidePayout: true, block: { tone: 'info', title, lines: present<Line>([[`${amount} 會退回買家的信用卡，不需要你操作。`], oneLine(who)]) } };
  }

  if (req?.status === 'pending' && status === 'to_ship') {
    const overdue = isRespondOverdue(req.respond_by, ctx.now);
    return { ...none, badge: 'requested', block: { tone: 'warning', title: '買家申請取消這筆訂單', lines: [
      [`原因：${reasonText(req.reason, req.note)}。申請時間 ${ctx.time(req.requested_at)}。`],
      [overdue ? '回應期限已到，系統正在處理。' : `請在 ${ctx.time(req.respond_by)} 前回應。逾時，系統會自動同意取消並退款。`],
    ] } };
  }
  if (req?.status === 'rejected' && status === 'to_ship') {
    return { ...none, block: { tone: 'neutral', title: '你已拒絕買家的取消申請', lines: [[`原因：${req.reject_reason ?? ''}`], ['買家不能再申請取消這筆訂單。']] } };
  }
  if (req?.status === 'withdrawn' && status === 'to_ship') {
    return { ...none, block: { tone: 'neutral', title: '買家已撤回取消申請', lines: [['訂單照常出貨。']] } };
  }

  // S11：賣家只看得到付過款的線上單，已取消卻讀不到退款資料（讀取失敗或排程空檔）
  if (payment === 'ecpay_card' && status === 'cancelled') {
    return { ...none, hidePayout: true, block: { tone: 'info', title: '退款處理中', lines: [['退款資料暫時讀不到，稍後重新整理。']] } };
  }
  return none;
}

// ── 列表排序與待辦文案 ──
/** 申請中的訂單排最前，其餘維持原順序（設計 5.1） */
export function sortPendingFirst<T>(orders: T[], isPending: (o: T) => boolean): T[] {
  return [...orders.filter(isPending), ...orders.filter(o => !isPending(o))];
}

/** 手機底欄「訂單管理」格的 aria-label：有取消申請才指定（待出貨為 0 時省略前半）；沒有申請回 undefined，恢復成現況 */
export function ordersNavLabel(toShip: number, pending: number): string | undefined {
  if (pending <= 0) return undefined;
  return toShip > 0 ? `訂單管理，待出貨 ${toShip} 筆，取消申請 ${pending} 筆` : `訂單管理，取消申請 ${pending} 筆`;
}

/** 賣場總覽「取消申請 N」提示列（設計 6.2） */
export function dashboardCancelPrompt(pending: number, earliestRespondBy: string | null, time: (iso: string) => string): { title: string; body: string } {
  return {
    title: `取消申請 ${pending}`,
    body: earliestRespondBy
      ? `買家在等你同意或拒絕。最早的回應期限是 ${time(earliestRespondBy)}，逾時會自動同意並退款。`
      : '買家在等你同意或拒絕。',
  };
}
