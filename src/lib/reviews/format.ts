// 評價用的日期與文字格式。時間一律台北時區（規格 A-2），不看使用者裝置的時區。

const parts = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});

function taipeiParts(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const p = Object.fromEntries(parts.formatToParts(d).map(x => [x.type, x.value]));
  return { y: p.year, mo: p.month, d: p.day, h: p.hour, mi: p.minute };
}

/** YYYY-MM-DD（台北時間）；無法解析時回空字串 */
export function taipeiDate(iso: string): string {
  const p = taipeiParts(iso);
  return p ? `${p.y}-${p.mo}-${p.d}` : '';
}

/** YYYY-MM-DD HH:mm（台北時間） */
export function taipeiDateTime(iso: string): string {
  const p = taipeiParts(iso);
  return p ? `${p.y}-${p.mo}-${p.d} ${p.h}:${p.mi}` : '';
}

/** R-3 顯示文字：期限那天的 23:59 */
export const deadlineLabel = (deadlineDate: string) => `評價期限：${deadlineDate} 23:59`;
export const deadlineDateTime = (deadlineDate: string) => `${deadlineDate} 23:59`;

export const ratingText = (avg: number) => avg.toFixed(1);

/** 星等顯示的文字替代（spec S-8） */
export const avgStarsLabel = (avg: number, count: number) => `評分 ${ratingText(avg)}，滿分 5 分，共 ${count} 則評價`;
export const starsLabel = (n: number) => `評分 ${n}，滿分 5 分`;

export const STAR_WORDS = ['', '非常不滿意', '不滿意', '普通', '滿意', '非常滿意'] as const;
