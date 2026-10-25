const TAIPEI = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit' });

/** 封鎖時間 → 台北日期 YYYY/MM/DD；無法解析時回空字串 */
export function blockedDate(at: number): string {
  if (!Number.isFinite(at)) return '';
  const parts = TAIPEI.formatToParts(new Date(at));
  const get = (t: string) => parts.find(p => p.type === t)?.value ?? '';
  const y = get('year');
  return y ? `${y}/${get('month')}/${get('day')}` : '';
}
