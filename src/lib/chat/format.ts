// 日期分隔、訊息時間、列表時間與列表摘要（純函式）。全部用裝置的本機時區：使用者看到的「今天」就是他手機上的今天。
import type { LastMessage } from './types';

const WEEK = '日一二三四五六';
const pad = (n: number) => String(n).padStart(2, '0');
const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
/** 幾天前（以日曆日算，不是 24 小時）；未來時間算 0 */
const daysAgo = (d: Date, now: Date) => Math.max(0, Math.round((startOfDay(now) - startOfDay(d)) / 86_400_000));

/** 每則訊息旁的時間，24 小時制 */
export function clockTime(iso: string): string {
  const d = new Date(iso);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** 訊息區的日期分隔：今天／昨天／本年「10月27日 星期二」／跨年「2025年12月7日」 */
export function dateLabel(iso: string, now: Date): string {
  const d = new Date(iso);
  const ago = daysAgo(d, now);
  if (ago === 0) return '今天';
  if (ago === 1) return '昨天';
  if (d.getFullYear() === now.getFullYear()) return `${d.getMonth() + 1}月${d.getDate()}日 星期${WEEK[d.getDay()]}`;
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
}

/** 列表右上角的時間：今天看時間、昨天、7 天內看星期、今年看月/日、跨年看年/月/日 */
export function listTime(iso: string, now: Date): string {
  const d = new Date(iso);
  const ago = daysAgo(d, now);
  if (ago === 0) return clockTime(iso);
  if (ago === 1) return '昨天';
  if (ago < 7) return `星期${WEEK[d.getDay()]}`;
  if (d.getFullYear() === now.getFullYear()) return `${d.getMonth() + 1}/${d.getDate()}`;
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
}

export interface DateGroup<T> { label: string; key: string; items: T[] }

/** 依日期分組，保持原本的順序（輸入要已由舊到新排好）。同一天連續的訊息放同一組 */
export function groupByDate<T>(items: T[], at: (item: T) => string, now: Date): DateGroup<T>[] {
  const groups: DateGroup<T>[] = [];
  for (const item of items) {
    const d = new Date(at(item));
    const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    const last = groups[groups.length - 1];
    if (last && last.key === key) last.items.push(item);
    else groups.push({ label: dateLabel(at(item), now), key, items: [item] });
  }
  return groups;
}

/** 列表的最後一則摘要：文字 ＞「[圖片]」＞「[商品]」／「[訂單]」；自己送的加「你：」 */
export function previewText(last: LastMessage): string {
  const body = last.text?.trim()
    ? last.text.trim()
    : last.photo_count > 0 ? '[圖片]'
    : last.card_type === 'product' ? '[商品]'
    : last.card_type === 'order' ? '[訂單]'
    : '';
  return last.mine && body ? `你：${body}` : body;
}

/** 讀屏念的摘要：不念括號與「你：」 */
export function previewSpoken(last: LastMessage): string {
  if (last.text?.trim()) return last.text.trim();
  if (last.photo_count > 0) return '圖片';
  if (last.card_type === 'product') return '商品卡';
  if (last.card_type === 'order') return '訂單卡';
  return '';
}

/** 列表一列的朗讀：「好物小舖，2 則未讀，最後訊息：有的，19:02」 */
export function rowSpoken(r: { name: string; unread: number; last: LastMessage; time: string; blocked: boolean }): string {
  const parts = [r.name];
  if (r.unread > 0) parts.push(`${r.unread} 則未讀`);
  if (r.blocked) parts.push('已封鎖');
  parts.push(`最後訊息：${previewSpoken(r.last)}`);
  parts.push(r.time);
  return parts.join('，');
}
