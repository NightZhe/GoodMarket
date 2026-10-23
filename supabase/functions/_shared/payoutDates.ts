// 撥款對帳的日期工具。「今天」一律台灣時間（UTC+8，沒有日光節約）。日期都是 'YYYY-MM-DD' 字串。

/** 一次查詢最多幾天（含頭尾）。35670「調閱區間最大為1個月」；綠界測試環境實測見 t8-local-tests.md §1 */
export const MAX_RANGE_DAYS = 28;
/** 每日排程往回查幾天（D41＝A：依結算日，今天往前 14 天到今天） */
export const DAILY_LOOKBACK_DAYS = 14;

const RE = /^\d{4}-\d{2}-\d{2}$/;
function toMs(d: string): number {
  const ms = Date.parse(d + 'T00:00:00Z');
  if (!RE.test(d) || Number.isNaN(ms) || new Date(ms).toISOString().slice(0, 10) !== d) throw new Error(`日期格式不正確：${d}`);
  return ms;
}
export const isDate = (d: unknown): d is string => { try { return typeof d === 'string' && toMs(d) > 0; } catch { return false; } };
export const addDays = (d: string, n: number) => new Date(toMs(d) + n * 86400_000).toISOString().slice(0, 10);
export const twToday = (nowMs: number) => new Date(nowMs + 8 * 3600_000).toISOString().slice(0, 10);
export const dayCount = (from: string, to: string) => (toMs(to) - toMs(from)) / 86400_000 + 1;

/** 把 from～to（含頭尾）拆成每段 ≤ MAX_RANGE_DAYS 天、不重疊、接起來剛好等於原範圍（AC-R5） */
export function splitRange(from: string, to: string, maxDays = MAX_RANGE_DAYS): { from: string; to: string }[] {
  if (toMs(from) > toMs(to)) throw new Error(`開始日 ${from} 晚於結束日 ${to}`);
  const out: { from: string; to: string }[] = [];
  for (let s = from; toMs(s) <= toMs(to); s = addDays(s, maxDays)) {
    const e = addDays(s, maxDays - 1);
    out.push({ from: s, to: toMs(e) < toMs(to) ? e : to });
  }
  return out;
}

export const dailyWindow = (nowMs: number) => { const to = twToday(nowMs); return { from: addDays(to, -DAILY_LOOKBACK_DAYS), to }; };
