import type { OrderStatus } from '../../types';
import { money } from '../format';
import { PAYOUT_IDS_LIMIT, type PayoutStatus, type SellerOrderPayoutRow } from './types';

// 賣家訂單頁的撥款區塊：撥款狀態 → 標籤與說明（spec-payout-reconcile.md §8.1、§8.3；介面 interface-payment.md 第 9 章）。
// 資料全部照抄綠界的對帳結果，這裡不推算、不補日期（D44＝A）；日期一律台灣日期。

export type PayoutTone = 'info' | 'success' | 'warning' | 'neutral';

export interface PayoutView {
  status: PayoutStatus;
  tone: PayoutTone;
  /** 標籤上看得到的字（含月/日） */
  label: string;
  /** 給讀屏的版本：日期念完整（「10 月 28 日」），不念「十斜線二十八」 */
  labelSr: string;
  description: string;
  /** 「撥款金額 $1,234」：只在預計撥款與已撥款，而且對帳檔有金額才有（D42＝C） */
  amountLine: string | null;
  /** 「資料更新於 2026/10/20 15:12」：這家店最近一次成功匯入的時間，updating 沒有 */
  updatedLine: string | null;
}

export interface PayoutViewInput {
  orderStatus: OrderStatus;
  /** 退款處理中、已退款的單（sellerRefundView.hidePayout）：不能顯示成會撥款，只有「已退款扣回」是真的事實 */
  hidePayout: boolean;
  /** undefined＝讀取失敗、離線第一次載入、或回應裡沒有這張單 */
  row: SellerOrderPayoutRow | undefined;
}

// 和 SellerOrders 現況逐字相同（對帳開關關著、RPC 不存在、讀取失敗時畫面不能變）
const UPDATING: PayoutView = {
  status: 'updating', tone: 'neutral', label: '撥款資料更新中', labelSr: '撥款資料更新中',
  description: '綠界科技的對帳資料還沒送來。資料送來後這裡會更新，不影響出貨。預計撥款日與實際入帳時間以綠界科技為準。',
  amountLine: null, updatedLine: null,
};

const TZ = 'Asia/Taipei';

/** 台灣今天的日期 'YYYY-MM-DD' */
export function taipeiToday(now: number): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

/** 「2026/10/20 15:12」（台灣時間） */
export function updatedText(iso: string): string {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
      .formatToParts(new Date(iso)).map(x => [x.type, x.value]),
  );
  return `${p.year}/${p.month}/${p.day} ${p.hour}:${p.minute}`;
}

const sameYear = (ymd: string, today: string) => ymd.slice(0, 4) === today.slice(0, 4);

/** 「10/28」；跨年加年「2027/01/05」 */
function shortDate(ymd: string, today: string): string {
  return sameYear(ymd, today) ? ymd.slice(5).replace('-', '/') : ymd.replaceAll('-', '/');
}

/** 「10 月 28 日」；跨年「2027 年 1 月 5 日」 */
export function spokenDate(ymd: string, today: string): string {
  const [y, m, d] = ymd.split('-').map(Number);
  return sameYear(ymd, today) ? `${m} 月 ${d} 日` : `${y} 年 ${m} 月 ${d} 日`;
}

function clawbackText(r: SellerOrderPayoutRow, today: string): string {
  const who = r.clawback_amount != null ? `買家退款 ${money(r.clawback_amount)}` : '買家已退款';
  const date = r.clawback_date;
  if (!date) return `${who}，綠界科技會在撥款日從你的撥款扣除，日期確定後會顯示在這裡。`;
  const at = shortDate(date, today);
  return date <= today ? `${who}，已在 ${at} 從你的撥款扣除。` : `${who}，綠界科技會在 ${at} 從你的撥款扣除。`;
}

/**
 * 這張訂單的撥款區塊要顯示什麼；null＝整塊不顯示。
 * 已取消而且沒有對帳列（請款前就放棄授權，對帳檔永遠不會有它，§3.3）、或讀不到無法確認時不顯示；
 * 其餘讀不到撥款資料一律當「資料更新中」，不顯示錯誤。
 */
export function payoutView(input: PayoutViewInput, ctx: { today: string }): PayoutView | null {
  const { orderStatus, hidePayout, row } = input;
  if (hidePayout && row?.payout_status !== 'clawed_back') return null;
  if (orderStatus === 'cancelled' && !row?.has_ledger_rows) return null;
  if (!row) return UPDATING;

  const updatedLine = row.data_updated_at ? `資料更新於 ${updatedText(row.data_updated_at)}` : null;
  const amountLine = row.payout_amount != null ? `撥款金額 ${money(row.payout_amount)}` : null;
  const { today } = ctx;

  switch (row.payout_status) {
    case 'captured':
      return {
        status: 'captured', tone: 'info', label: '已請款', labelSr: '已請款',
        description: '買家付款成功，好物集已向綠界科技請款。預計撥款日由綠界科技提供，目前還沒有資料。',
        amountLine: null, updatedLine,
      };
    case 'scheduled': {
      const d = row.expected_payout_date;
      return {
        status: 'scheduled', tone: 'info',
        label: d ? `預計 ${shortDate(d, today)} 撥款` : '預計撥款', labelSr: d ? `預計 ${spokenDate(d, today)}撥款` : '預計撥款',
        description: '預計撥入你的綠界科技帳戶，實際以綠界科技為準。', amountLine, updatedLine,
      };
    }
    case 'paid_out': {
      const d = row.paid_out_date;
      return {
        status: 'paid_out', tone: 'success',
        label: d ? `已撥款 ${shortDate(d, today)}` : '已撥款', labelSr: d ? `已撥款，${spokenDate(d, today)}` : '已撥款',
        description: '已撥入你的綠界科技帳戶。提領到銀行的時間以綠界科技為準。', amountLine, updatedLine,
      };
    }
    case 'clawed_back':
      return {
        status: 'clawed_back', tone: 'warning', label: '已退款扣回', labelSr: '已退款扣回',
        description: clawbackText(row, today), amountLine: null, updatedLine,
      };
    case 'updating':
      return UPDATING;
  }
}

/** 一次請求帶整頁的訂單；超過 RPC 上限（200）才分批 */
export function chunkIds(ids: string[]): string[][] {
  const out: string[][] = [];
  for (let i = 0; i < ids.length; i += PAYOUT_IDS_LIMIT) out.push(ids.slice(i, i + PAYOUT_IDS_LIMIT));
  return out;
}
