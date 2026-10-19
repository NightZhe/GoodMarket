// 待付款的逾時（建單後 30 分鐘，伺服器決定）。畫面只顯示靜態的「請在 14:32 前付款」（設計 9.2：不做倒數動畫，
// 倒數會讓 VoiceOver 一直念）；時間到時用 msUntil 排一次計時器，呼叫 expire_my_pending_orders 並重讀。

const toMs = (iso: string | null | undefined): number => (iso ? Date.parse(iso) : NaN);

/** 離逾時還有多久；已到、已過、時間字串壞掉都回 0（壞資料當作到期，讓畫面去重讀伺服器，不會永遠等） */
export function msUntil(expiresAt: string | null | undefined, now: number): number {
  const t = toMs(expiresAt);
  return Number.isFinite(t) ? Math.max(0, t - now) : 0;
}

export const isPastDeadline = (expiresAt: string | null | undefined, now: number): boolean => msUntil(expiresAt, now) === 0;

/** 本機時區的 HH:mm；壞資料回空字串（畫面省略那一句） */
export function clockText(iso: string | null | undefined): string {
  const t = toMs(iso);
  if (!Number.isFinite(t)) return '';
  const d = new Date(t);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
