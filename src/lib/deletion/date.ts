import { taipeiDate } from '../reviews/format';

// 刪除申請的日期顯示。預計完成日（due_date）是伺服器算好的台北日期 'YYYY-MM-DD'，前端只換格式、不計算（R-D3）；
// 申請日由 requested_at（帶時區的時間字串）換成台北日期。無法解析一律回空字串，由畫面決定不顯示。

const YMD = /^(\d{4})-(\d{2})-(\d{2})$/;

function parts(ymd: string): { y: number; m: number; d: number } | null {
  const hit = YMD.exec(ymd);
  if (!hit) return null;
  const [y, m, d] = [Number(hit[1]), Number(hit[2]), Number(hit[3])];
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  return { y, m, d };
}

/** 'YYYY-MM-DD' → 'YYYY/MM/DD'（畫面上看的樣子） */
export function slashDate(ymd: string): string {
  return parts(ymd) ? ymd.replaceAll('-', '/') : '';
}

/** 'YYYY-MM-DD' → '2026 年 11 月 4 日'（給讀屏念，避免斜線被念出來） */
export function spokenDate(ymd: string): string {
  const p = parts(ymd);
  return p ? `${p.y} 年 ${p.m} 月 ${p.d} 日` : '';
}

/** 帶時區的時間字串 → 台北日期 'YYYY-MM-DD'；無法解析回空字串 */
export const requestedYmd = (iso: string): string => taipeiDate(iso);
